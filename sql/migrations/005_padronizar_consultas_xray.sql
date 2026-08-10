-- =============================================================================
-- Migration: padronizar consultas (contrato canônico site/whatsapp)
-- Funções + trigger + RPC para produtores novos (xray/api/mcp).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_padronizar_consulta ON busca_fornecedor.consultas;
--   DROP FUNCTION IF EXISTS busca_fornecedor.trg_padronizar_consulta();
--   DROP FUNCTION IF EXISTS public.registrar_consulta(jsonb, jsonb, text, uuid, text, text, uuid);
--   DROP FUNCTION IF EXISTS busca_fornecedor.enriquecer_resultados_consulta(uuid);
--   DROP FUNCTION IF EXISTS busca_fornecedor.normalizar_parametros_consulta(jsonb);
--   DROP FUNCTION IF EXISTS busca_fornecedor._resultado_ja_canonico(jsonb);
-- =============================================================================

CREATE OR REPLACE FUNCTION busca_fornecedor._resultado_ja_canonico(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    jsonb_typeof(p) = 'array'
    AND jsonb_array_length(p) > 0
    AND (p->0) ? 'item'
    AND (
      (p->0->'item') ? 'razao_social'
      OR (p->0->'item') ? 'nota'
    );
$$;

CREATE OR REPLACE FUNCTION busca_fornecedor.normalizar_parametros_consulta(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v jsonb := COALESCE(p, '{}'::jsonb);
  v_filter jsonb := COALESCE(v->'filter', '{}'::jsonb);
  v_filter_not jsonb := COALESCE(v->'filter_not', '{}'::jsonb);
  v_queries jsonb := COALESCE(v->'queries', '{}'::jsonb);
  v_descricao text;
  v_cidades text[];
  v_ufs text[];
  v_tipo text;
  v_cnpjs text;
  v_raw jsonb;
BEGIN
  -- Já canônico (tem descricao e não parece payload cru do motor)
  IF (v ? 'descricao')
     AND COALESCE(v->>'descricao', '') <> ''
     AND NOT (v ? 'query' AND v ? 'weights')
  THEN
    RETURN v;
  END IF;

  v_descricao := NULLIF(TRIM(COALESCE(
    v->>'descricao',
    v->>'query',
    v->>'query_text',
    v->>'bm25_query',
    v_queries->>'descricao',
    ''
  )), '');

  IF jsonb_typeof(v_filter->'cidade') = 'array' THEN
    SELECT array_agg(x) INTO v_cidades
    FROM jsonb_array_elements_text(v_filter->'cidade') AS t(x);
  ELSIF jsonb_typeof(v_filter->'municipio') = 'array' THEN
    SELECT array_agg(x) INTO v_cidades
    FROM jsonb_array_elements_text(v_filter->'municipio') AS t(x);
  ELSIF NULLIF(v_filter->>'cidade', '') IS NOT NULL THEN
    v_cidades := ARRAY[v_filter->>'cidade'];
  ELSE
    v_cidades := COALESCE(
      (SELECT array_agg(x) FROM jsonb_array_elements_text(COALESCE(v->'municipio', '[]'::jsonb)) t(x)),
      ARRAY[]::text[]
    );
  END IF;

  IF jsonb_typeof(v_filter->'uf') = 'array' THEN
    SELECT array_agg(x) INTO v_ufs
    FROM jsonb_array_elements_text(v_filter->'uf') AS t(x);
  ELSIF NULLIF(v_filter->>'uf', '') IS NOT NULL THEN
    v_ufs := ARRAY[v_filter->>'uf'];
  ELSIF jsonb_typeof(v->'ufs_selecionadas') = 'array' THEN
    SELECT array_agg(x) INTO v_ufs
    FROM jsonb_array_elements_text(v->'ufs_selecionadas') AS t(x);
  ELSE
    v_ufs := ARRAY[]::text[];
  END IF;

  IF COALESCE(array_length(v_cidades, 1), 0) > 0 THEN
    v_tipo := 'city';
  ELSIF COALESCE(array_length(v_ufs, 1), 0) > 0 THEN
    v_tipo := 'uf';
  ELSE
    v_tipo := 'nacional';
  END IF;

  IF jsonb_typeof(v_filter_not->'cnpj') = 'array' THEN
    SELECT string_agg(x, ',') INTO v_cnpjs
    FROM jsonb_array_elements_text(v_filter_not->'cnpj') AS t(x);
  ELSE
    v_cnpjs := COALESCE(v->>'cnpjs_existentes', '');
  END IF;

  v_raw := COALESCE(v->'raw', jsonb_strip_nulls(jsonb_build_object(
    'query', v->>'query',
    'queries', v_queries,
    'weights', v->'weights',
    'filter', v_filter,
    'filter_not', v_filter_not,
    'intent', COALESCE(v->>'intent', v->>'qualidade'),
    'bm25', v->'bm25',
    'bm25_query', v->>'bm25_query',
    'final_limit', v->'final_limit',
    'limit_per_vector', v->'limit_per_vector',
    'debug', v->'debug',
    'rerank', v->'rerank',
    'fallback', v->'fallback'
  )));

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'descricao', v_descricao,
    'tipo_busca', COALESCE(NULLIF(v->>'tipo_busca', ''), v_tipo),
    'cidade_origem', COALESCE(
      NULLIF(v->>'cidade_origem', ''),
      CASE WHEN COALESCE(array_length(v_cidades, 1), 0) > 0 THEN v_cidades[1] ELSE NULL END
    ),
    'raio_km', COALESCE(v->'raio_km', v->'radius_km'),
    'ufs_selecionadas', to_jsonb(COALESCE(v_ufs, ARRAY[]::text[])),
    'cnpjs_existentes', COALESCE(v_cnpjs, ''),
    'modelo_negocio', COALESCE(
      v_filter->>'modelo_negocio',
      v->>'modelo_negocio'
    ),
    'raw', v_raw
  ));
END;
$$;

COMMENT ON FUNCTION busca_fornecedor.normalizar_parametros_consulta(jsonb) IS
  'Mapeia parametros do motor (xray/api) para o contrato canônico do front; preserva raw.';

CREATE OR REPLACE FUNCTION busca_fornecedor.enriquecer_resultados_consulta(p_consulta_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'busca_fornecedor', 'public', 'cnpj_db'
AS $$
DECLARE
  v_row busca_fornecedor.consultas%ROWTYPE;
  v_in jsonb;
  v_out jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_src jsonb;
  v_basico text;
  v_nota numeric;
  v_score numeric;
  v_nome text;
  v_tel text;
  v_email text;
  v_site text;
  v_ig text;
  v_escopo text;
  v_plano text;
  v_selo text;
  v_fornecedor_id text;
  v_n_listagens bigint;
  v_limite text;
  v_modelo text;
  v_cp RECORD;
  v_uf_list text[] := ARRAY[]::text[];
  v_mun_list text[] := ARRAY[]::text[];
  v_ufs_out text[];
  v_mun_out text[];
  i int := 0;
BEGIN
  SELECT * INTO v_row FROM busca_fornecedor.consultas WHERE id = p_consulta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'consulta_nao_encontrada: %', p_consulta_id;
  END IF;

  v_in := COALESCE(v_row.resultados, '[]'::jsonb);
  IF jsonb_typeof(v_in) <> 'array' THEN
    RETURN v_in;
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_in)
  LOOP
    i := i + 1;
    IF v_elem ? 'item' THEN
      v_src := v_elem->'item';
    ELSE
      v_src := v_elem;
    END IF;

    v_basico := regexp_replace(COALESCE(
      v_src->>'cnpj_basico',
      left(regexp_replace(COALESCE(v_src->>'cnpj', ''), '\D', '', 'g'), 8),
      ''
    ), '\D', '', 'g');
    IF length(v_basico) > 8 THEN
      v_basico := left(v_basico, 8);
    END IF;
    IF v_basico = '' THEN
      v_basico := NULL;
    END IF;

    v_score := NULLIF(v_src->>'score_final', '')::numeric;
    -- Nota posicional (paridade n8n): 100..75 linear; nacional = 100
    -- (v_score só informativo; não define a nota de aparição)

    v_nome := COALESCE(NULLIF(v_src->>'razao_social', ''), NULLIF(v_src->>'nome_empresa', ''));
    v_tel := NULLIF(v_src->>'telefone', '');
    v_email := NULLIF(v_src->>'email', '');
    v_site := NULLIF(v_src->>'site', '');
    v_ig := NULLIF(v_src->>'instagram', '');
    v_escopo := NULLIF(v_src->>'escopo', '');
    v_plano := NULLIF(v_src->>'plano_categoria', '');
    v_fornecedor_id := COALESCE(NULLIF(v_src->>'fornecedor_id', ''), NULLIF(v_src->>'id', ''));
    v_modelo := NULLIF(v_src->>'modelo_negocio', '');
    v_n_listagens := COALESCE(NULLIF(v_src->>'n_listagens', '')::bigint, 0);
    v_limite := COALESCE(
      NULLIF(v_src->>'limite_listagens ', ''),
      NULLIF(v_src->>'limite_listagens', ''),
      '10'
    );

    IF v_basico IS NOT NULL THEN
      SELECT id, nome_empresa, municipio, uf, full_profile
        INTO v_cp
      FROM busca_fornecedor.company_profile
      WHERE cnpj = v_basico
      LIMIT 1;

      IF FOUND THEN
        v_nome := COALESCE(v_nome, v_cp.nome_empresa);
        v_fornecedor_id := COALESCE(v_fornecedor_id, v_cp.id::text);
        IF v_tel IS NULL THEN
          SELECT string_agg(x, ' ') INTO v_tel
          FROM jsonb_array_elements_text(COALESCE(v_cp.full_profile->'contato'->'telefones', '[]'::jsonb)) t(x);
        END IF;
        IF v_email IS NULL THEN
          SELECT string_agg(x, ' ') INTO v_email
          FROM jsonb_array_elements_text(COALESCE(v_cp.full_profile->'contato'->'emails', '[]'::jsonb)) t(x);
        END IF;
        v_site := COALESCE(v_site, NULLIF(v_cp.full_profile->'contato'->>'url_site', ''));
        v_ig := COALESCE(v_ig, NULLIF(v_cp.full_profile->'contato'->>'url_instagram', ''));
        IF v_escopo IS NULL THEN
          IF lower(COALESCE(v_cp.full_profile->'classificacao'->>'cobertura_geografica', ''))
             ~ '(brasil|nacional|todo o pa[ií]s|nationwide)' THEN
            v_escopo := 'nacional';
          END IF;
        END IF;
        IF NULLIF(v_src->>'uf', '') IS NULL AND v_cp.uf IS NOT NULL THEN
          v_src := v_src || jsonb_build_object('uf', v_cp.uf);
        END IF;
        IF NULLIF(COALESCE(v_src->>'cidade', v_src->>'municipio'), '') IS NULL AND v_cp.municipio IS NOT NULL THEN
          v_src := v_src || jsonb_build_object('cidade', v_cp.municipio);
        END IF;
      END IF;

      -- Nota posicional (n8n) — depois de resolver escopo nacional
      IF lower(COALESCE(v_escopo, '')) IN ('nacional', 'national') THEN
        v_nota := 100;
      ELSIF jsonb_array_length(v_in) <= 1 THEN
        v_nota := 100;
      ELSE
        v_nota := GREATEST(
          75,
          LEAST(
            100,
            round(100 - (25.0 * (i - 1)) / (jsonb_array_length(v_in) - 1))
          )
        );
      END IF;

      SELECT uf.plano_categoria, uf.selo_exibicao
        INTO v_plano, v_selo
      FROM busca_fornecedor.usuario_fornecedor uf
      WHERE uf.cnpj_basico = v_basico
      LIMIT 1;

      -- SELECT INTO sem linha zera as vars; preservar o que já veio no resultado
      IF NOT FOUND THEN
        v_plano := NULLIF(v_src->>'plano_categoria', '');
        v_selo := NULLIF(v_src->>'selo_exibicao', '');
      ELSE
        v_plano := COALESCE(v_plano, NULLIF(v_src->>'plano_categoria', ''));
      END IF;

      SELECT ca.n_aparicoes, ca.limite_aparicoes::text
        INTO v_n_listagens, v_limite
      FROM busca_fornecedor.contador_aparicoes ca
      WHERE ca.cnpj = v_basico
      LIMIT 1;

      IF NOT FOUND THEN
        v_n_listagens := COALESCE(NULLIF(v_src->>'n_listagens', '')::bigint, 0);
        v_limite := COALESCE(
          NULLIF(v_src->>'limite_listagens ', ''),
          NULLIF(v_src->>'limite_listagens', ''),
          '10'
        );
      ELSE
        v_n_listagens := COALESCE(v_n_listagens, 0);
        v_limite := COALESCE(v_limite, '10');
      END IF;

      -- Aparição faltante (ordem/dv null = padrão site; evita FK inventada)
      BEGIN
        INSERT INTO busca_fornecedor.aparicoes (
          consulta_id, comprador_id, cnpj_basico, cnpj_ordem, cnpj_dv, nota, revelada
        ) VALUES (
          p_consulta_id,
          v_row.comprador,
          v_basico,
          NULL,
          NULL,
          COALESCE(v_nota, 0)::bigint,
          false
        );
      EXCEPTION WHEN unique_violation THEN
        NULL;
      WHEN foreign_key_violation THEN
        NULL;
      END;

      BEGIN
        INSERT INTO busca_fornecedor.contador_aparicoes (cnpj, n_aparicoes, limite_aparicoes, updated_at)
        VALUES (v_basico, 1, 999, CURRENT_DATE)
        ON CONFLICT (cnpj) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    ELSE
      IF jsonb_array_length(v_in) <= 1 THEN
        v_nota := 100;
      ELSE
        v_nota := GREATEST(
          75,
          LEAST(
            100,
            round(100 - (25.0 * (i - 1)) / (jsonb_array_length(v_in) - 1))
          )
        );
      END IF;
    END IF;

    IF NULLIF(v_src->>'uf', '') IS NOT NULL THEN
      v_uf_list := array_append(v_uf_list, upper(v_src->>'uf'));
    END IF;
    IF NULLIF(COALESCE(v_src->>'cidade', v_src->>'municipio'), '') IS NOT NULL THEN
      v_mun_list := array_append(
        v_mun_list,
        COALESCE(v_src->>'cidade', v_src->>'municipio')
      );
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'item', jsonb_strip_nulls(jsonb_build_object(
        'razao_social', v_nome,
        'cnpj_basico', v_basico,
        'nota', v_nota,
        'telefone', v_tel,
        'email', v_email,
        'site', v_site,
        'instagram', v_ig,
        'escopo', v_escopo,
        'plano_categoria', v_plano,
        'selo_exibicao', v_selo,
        'fornecedor_id', v_fornecedor_id,
        'consulta_id', p_consulta_id::text,
        'n_listagens', v_n_listagens,
        'limite_listagens ', v_limite,
        'modelo_negocio', v_modelo,
        'posicao', COALESCE(NULLIF(v_src->>'posicao', '')::int, i)
      ))
    ));
  END LOOP;

  -- Preenche uf/municipio da consulta se vazios
  SELECT array_agg(DISTINCT x) INTO v_ufs_out FROM unnest(v_uf_list) t(x) WHERE x IS NOT NULL AND x <> '';
  SELECT array_agg(DISTINCT x) INTO v_mun_out FROM unnest(v_mun_list) t(x) WHERE x IS NOT NULL AND x <> '';

  UPDATE busca_fornecedor.consultas c
  SET
    resultados = v_out,
    uf = CASE
      WHEN c.uf IS NULL OR cardinality(c.uf) = 0 THEN v_ufs_out
      ELSE c.uf
    END,
    municipio = CASE
      WHEN c.municipio IS NULL OR cardinality(c.municipio) = 0 THEN v_mun_out
      ELSE c.municipio
    END,
    bm_25 = COALESCE(
      c.bm_25,
      NULLIF(c.parametros->>'descricao', ''),
      NULLIF(c.parametros->'raw'->>'query', '')
    ),
    v_descricao = COALESCE(
      c.v_descricao,
      NULLIF(c.parametros->'raw'->'queries'->>'descricao', ''),
      NULLIF(c.parametros->>'descricao', '')
    )
  WHERE c.id = p_consulta_id;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION busca_fornecedor.enriquecer_resultados_consulta(uuid) IS
  'Reescreve resultados no formato {item:{...}} canônico; preenche uf/municipio; registra aparicoes faltantes.';

CREATE OR REPLACE FUNCTION busca_fornecedor.trg_padronizar_consulta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'busca_fornecedor', 'public'
AS $$
DECLARE
  v_q text;
  v_need_params boolean;
  v_need_results boolean;
  v_need_qualidade boolean;
BEGIN
  -- Evita recursão / reentrada
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  v_need_params :=
    NEW.parametros IS NULL
    OR NOT (NEW.parametros ? 'descricao')
    OR COALESCE(NEW.parametros->>'descricao', '') = '';

  v_need_qualidade :=
    NEW.qualidade IS NOT NULL
    AND NEW.qualidade NOT IN ('Ótimo', 'Bom', 'Ruim', 'Péssimo');

  v_need_results :=
    NEW.resultados IS NOT NULL
    AND jsonb_typeof(NEW.resultados) = 'array'
    AND jsonb_array_length(NEW.resultados) > 0
    AND NOT busca_fornecedor._resultado_ja_canonico(NEW.resultados);

  IF v_need_params THEN
    NEW.parametros := busca_fornecedor.normalizar_parametros_consulta(NEW.parametros);
  END IF;

  IF v_need_qualidade THEN
    v_q := NEW.qualidade;
    NEW.parametros := COALESCE(NEW.parametros, '{}'::jsonb);
    NEW.parametros := jsonb_set(
      NEW.parametros,
      '{raw}',
      COALESCE(NEW.parametros->'raw', '{}'::jsonb) || jsonb_build_object('intent', v_q),
      true
    );
    NEW.qualidade := NULL;
  END IF;

  -- Densas a partir de parametros normalizados
  IF (NEW.bm_25 IS NULL OR NEW.bm_25 = '') AND NEW.parametros ? 'descricao' THEN
    NEW.bm_25 := NEW.parametros->>'descricao';
  END IF;

  IF (NEW.uf IS NULL OR cardinality(NEW.uf) = 0)
     AND jsonb_typeof(NEW.parametros->'ufs_selecionadas') = 'array'
     AND jsonb_array_length(NEW.parametros->'ufs_selecionadas') > 0
  THEN
    SELECT array_agg(x) INTO NEW.uf
    FROM jsonb_array_elements_text(NEW.parametros->'ufs_selecionadas') t(x);
  END IF;

  IF (NEW.municipio IS NULL OR cardinality(NEW.municipio) = 0)
     AND NULLIF(NEW.parametros->>'cidade_origem', '') IS NOT NULL
  THEN
    -- se há lista em raw.filter.cidade, preferir
    IF jsonb_typeof(NEW.parametros->'raw'->'filter'->'cidade') = 'array' THEN
      SELECT array_agg(x) INTO NEW.municipio
      FROM jsonb_array_elements_text(NEW.parametros->'raw'->'filter'->'cidade') t(x);
    ELSE
      NEW.municipio := ARRAY[NEW.parametros->>'cidade_origem'];
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_padronizar_consulta_before ON busca_fornecedor.consultas;
CREATE TRIGGER trg_padronizar_consulta_before
  BEFORE INSERT OR UPDATE OF parametros, resultados, qualidade, uf, municipio, bm_25
  ON busca_fornecedor.consultas
  FOR EACH ROW
  EXECUTE FUNCTION busca_fornecedor.trg_padronizar_consulta();

CREATE OR REPLACE FUNCTION busca_fornecedor.trg_enriquecer_resultados_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'busca_fornecedor', 'public'
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.resultados IS NULL
     OR jsonb_typeof(NEW.resultados) <> 'array'
     OR jsonb_array_length(NEW.resultados) = 0
  THEN
    RETURN NEW;
  END IF;

  -- Já no formato {item:{razao_social|nota}} → não reprocessa (idempotente)
  IF busca_fornecedor._resultado_ja_canonico(NEW.resultados) THEN
    RETURN NEW;
  END IF;

  PERFORM busca_fornecedor.enriquecer_resultados_consulta(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enriquecer_resultados_after ON busca_fornecedor.consultas;
CREATE TRIGGER trg_enriquecer_resultados_after
  AFTER INSERT OR UPDATE OF resultados
  ON busca_fornecedor.consultas
  FOR EACH ROW
  EXECUTE FUNCTION busca_fornecedor.trg_enriquecer_resultados_after();

-- Porta de entrada documentada (opcional para o pipeline)
CREATE OR REPLACE FUNCTION public.registrar_consulta(
  p_parametros jsonb,
  p_resultados jsonb,
  p_origem text DEFAULT 'xray',
  p_comprador uuid DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_execution_id text DEFAULT NULL,
  p_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'busca_fornecedor', 'public'
AS $$
DECLARE
  v_id uuid := COALESCE(p_id, gen_random_uuid());
  v_params jsonb;
BEGIN
  v_params := busca_fornecedor.normalizar_parametros_consulta(p_parametros);

  INSERT INTO busca_fornecedor.consultas (
    id, comprador, parametros, resultados, status,
    session_id, execution_id, origem, created_at
  ) VALUES (
    v_id,
    p_comprador,
    v_params,
    COALESCE(p_resultados, '[]'::jsonb),
    'concluida',
    p_session_id,
    COALESCE(p_execution_id, v_id::text),
    COALESCE(NULLIF(p_origem, ''), 'xray'),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET parametros = EXCLUDED.parametros,
        resultados = EXCLUDED.resultados,
        session_id = COALESCE(EXCLUDED.session_id, busca_fornecedor.consultas.session_id),
        execution_id = COALESCE(EXCLUDED.execution_id, busca_fornecedor.consultas.execution_id),
        origem = COALESCE(EXCLUDED.origem, busca_fornecedor.consultas.origem);

  -- AFTER trigger enriquecimento já roda no INSERT/UPDATE de resultados
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.registrar_consulta(jsonb, jsonb, text, uuid, text, text, uuid) IS
  'RPC canônica: grava consulta já passando por normalização/trigger de enriquecimento.';

GRANT EXECUTE ON FUNCTION busca_fornecedor.normalizar_parametros_consulta(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION busca_fornecedor.enriquecer_resultados_consulta(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_consulta(jsonb, jsonb, text, uuid, text, text, uuid) TO service_role;
