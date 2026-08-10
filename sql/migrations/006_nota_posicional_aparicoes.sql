-- =============================================================================
-- Migration: nota de aparição / resultados por posição (paridade n8n)
--   total<=1 → 100
--   senão → round(100 - 25*index/(total-1)) clamp [75,100]
--   escopo nacional → sempre 100
-- =============================================================================

CREATE OR REPLACE FUNCTION busca_fornecedor.nota_posicional(
  p_index int,   -- 0-based
  p_total int,
  p_escopo text DEFAULT NULL
)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_escopo, '')) IN ('nacional', 'national') THEN 100
    WHEN COALESCE(p_total, 0) <= 1 THEN 100
    WHEN COALESCE(p_index, 0) < 0 THEN 100
    ELSE GREATEST(
      75,
      LEAST(
        100,
        round(100 - (25.0 * p_index) / (p_total - 1))::int
      )
    )
  END;
$$;

COMMENT ON FUNCTION busca_fornecedor.nota_posicional(int, int, text) IS
  'Nota 75–100 por posição (n8n); nacional = 100.';

GRANT EXECUTE ON FUNCTION busca_fornecedor.nota_posicional(int, int, text) TO service_role;

-- Reescreve resultados[].item.nota nas consultas do pipeline novo
UPDATE busca_fornecedor.consultas c
SET resultados = (
  SELECT jsonb_agg(
    CASE
      WHEN elem ? 'item' THEN
        jsonb_set(
          elem,
          '{item,nota}',
          to_jsonb(
            busca_fornecedor.nota_posicional(
              (ord - 1)::int,
              jsonb_array_length(c.resultados)::int,
              elem->'item'->>'escopo'
            )
          ),
          true
        )
      ELSE elem
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(c.resultados) WITH ORDINALITY AS t(elem, ord)
)
WHERE c.origem IN ('xray', 'api', 'mcp')
  AND jsonb_typeof(c.resultados) = 'array'
  AND jsonb_array_length(c.resultados) > 0
  AND busca_fornecedor._resultado_ja_canonico(c.resultados);

-- Alinha aparicoes.nota com a nota do item (mesmo cnpj_basico na consulta)
UPDATE busca_fornecedor.aparicoes a
SET nota = sub.nota
FROM (
  SELECT
    c.id AS consulta_id,
    elem->'item'->>'cnpj_basico' AS cnpj_basico,
    busca_fornecedor.nota_posicional(
      (ord - 1)::int,
      jsonb_array_length(c.resultados)::int,
      elem->'item'->>'escopo'
    )::bigint AS nota
  FROM busca_fornecedor.consultas c
  CROSS JOIN LATERAL jsonb_array_elements(c.resultados) WITH ORDINALITY AS t(elem, ord)
  WHERE c.origem IN ('xray', 'api', 'mcp')
    AND elem ? 'item'
    AND NULLIF(elem->'item'->>'cnpj_basico', '') IS NOT NULL
) sub
WHERE a.consulta_id = sub.consulta_id
  AND a.cnpj_basico = sub.cnpj_basico;
