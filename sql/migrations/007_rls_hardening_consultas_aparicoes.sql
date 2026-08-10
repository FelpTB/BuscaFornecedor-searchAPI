-- =============================================================================
-- Migration 007: RLS hardening — consultas / aparicoes / usuario_comprador
-- Projeto: abcAdvise (hccolkrnyrxcbxuuajwq)
-- Schema: busca_fornecedor
--
-- Achado (auditoria live 2026-08-10):
--   • RLS já ENABLED nas tabelas
--   • Policies perigosas: "Permitir leitura pública - *" (anon SELECT true)
--   • consultas: "Anyone can create consultas" (INSERT público)
--   • usuario_comprador: authenticated SELECT true (qualquer auth lê todos)
--
-- Modelo:
--   • service_role continua bypass (writers da API+MCP / telemetria)
--   • authenticated: só dados próprios
--   • anon: negado
--   • aparicoes: mantém policy de fornecedor (CNPJ próprio) se existir
--   • contador_aparicoes: authenticated SELECT (agg); deny anon; writes = service_role
--
-- Rollback (restaurar NÃO é desejável — seria reabrir buraco):
--   -- recriar policies antigas apenas se necessário para emergência operacional
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) consultas — remover policies abertas
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Permitir leitura pública - consultas" ON busca_fornecedor.consultas;
DROP POLICY IF EXISTS "Anyone can create consultas" ON busca_fornecedor.consultas;
DROP POLICY IF EXISTS "Anonymous can view own session consultas" ON busca_fornecedor.consultas;
DROP POLICY IF EXISTS "Compradores podem ver apenas suas consultas" ON busca_fornecedor.consultas;
DROP POLICY IF EXISTS "consultas_select_own" ON busca_fornecedor.consultas;
DROP POLICY IF EXISTS "consultas_update_own" ON busca_fornecedor.consultas;
DROP POLICY IF EXISTS "consultas_no_anon" ON busca_fornecedor.consultas;

ALTER TABLE busca_fornecedor.consultas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consultas_select_own"
  ON busca_fornecedor.consultas
  FOR SELECT
  TO authenticated
  USING (comprador = auth.uid());

CREATE POLICY "consultas_update_own"
  ON busca_fornecedor.consultas
  FOR UPDATE
  TO authenticated
  USING (comprador = auth.uid())
  WITH CHECK (comprador = auth.uid());

CREATE POLICY "consultas_no_anon"
  ON busca_fornecedor.consultas
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

GRANT SELECT, UPDATE ON TABLE busca_fornecedor.consultas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.consultas TO service_role;

-- ---------------------------------------------------------------------------
-- 2) aparicoes — remover leitura pública; owner + fornecedor
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Permitir leitura pública - aparicoes" ON busca_fornecedor.aparicoes;
DROP POLICY IF EXISTS "Compradores visualizam aparicoes de suas consultas" ON busca_fornecedor.aparicoes;
DROP POLICY IF EXISTS "Fornecedores visualizam aparicoes do seu CNPJ" ON busca_fornecedor.aparicoes;
DROP POLICY IF EXISTS "aparicoes_select_own_comprador" ON busca_fornecedor.aparicoes;
DROP POLICY IF EXISTS "aparicoes_select_own_fornecedor" ON busca_fornecedor.aparicoes;
DROP POLICY IF EXISTS "aparicoes_no_anon" ON busca_fornecedor.aparicoes;

ALTER TABLE busca_fornecedor.aparicoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aparicoes_select_own_comprador"
  ON busca_fornecedor.aparicoes
  FOR SELECT
  TO authenticated
  USING (
    comprador_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM busca_fornecedor.consultas c
      WHERE c.id = aparicoes.consulta_id
        AND c.comprador = auth.uid()
    )
  );

-- Fornecedor autenticado vê aparições do próprio estabelecimento (se tabela existir)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'busca_fornecedor'
      AND table_name = 'usuario_fornecedor'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "aparicoes_select_own_fornecedor"
        ON busca_fornecedor.aparicoes
        FOR SELECT
        TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM busca_fornecedor.usuario_fornecedor uf
            WHERE uf.id = auth.uid()
              AND uf.cnpj_basico = aparicoes.cnpj_basico
              AND uf.cnpj_ordem IS NOT DISTINCT FROM aparicoes.cnpj_ordem
              AND uf.cnpj_dv IS NOT DISTINCT FROM aparicoes.cnpj_dv
          )
        )
    $pol$;
  END IF;
END $$;

CREATE POLICY "aparicoes_no_anon"
  ON busca_fornecedor.aparicoes
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

GRANT SELECT ON TABLE busca_fornecedor.aparicoes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.aparicoes TO service_role;

-- ---------------------------------------------------------------------------
-- 3) usuario_comprador — só o próprio perfil
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Permitir leitura pública - usuario_comprador" ON busca_fornecedor.usuario_comprador;
DROP POLICY IF EXISTS "auth users can read usuario_comprador" ON busca_fornecedor.usuario_comprador;
DROP POLICY IF EXISTS "Compradores podem ver apenas seus dados" ON busca_fornecedor.usuario_comprador;
DROP POLICY IF EXISTS "Compradores podem ver seu código embaixador" ON busca_fornecedor.usuario_comprador;
DROP POLICY IF EXISTS "usuario_comprador_select_own" ON busca_fornecedor.usuario_comprador;
DROP POLICY IF EXISTS "usuario_comprador_update_own" ON busca_fornecedor.usuario_comprador;
DROP POLICY IF EXISTS "usuario_comprador_no_anon" ON busca_fornecedor.usuario_comprador;

ALTER TABLE busca_fornecedor.usuario_comprador ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuario_comprador_select_own"
  ON busca_fornecedor.usuario_comprador
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "usuario_comprador_update_own"
  ON busca_fornecedor.usuario_comprador
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "usuario_comprador_no_anon"
  ON busca_fornecedor.usuario_comprador
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

GRANT SELECT, UPDATE ON TABLE busca_fornecedor.usuario_comprador TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.usuario_comprador TO service_role;

-- ---------------------------------------------------------------------------
-- 4) contador_aparicoes — agg sem PII de comprador; deny anon; auth read opcional
--    Writers continuam só via service_role (sem INSERT policy para authenticated)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "contador_aparicoes_select_authenticated" ON busca_fornecedor.contador_aparicoes;
DROP POLICY IF EXISTS "contador_aparicoes_no_anon" ON busca_fornecedor.contador_aparicoes;

ALTER TABLE busca_fornecedor.contador_aparicoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contador_aparicoes_select_authenticated"
  ON busca_fornecedor.contador_aparicoes
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "contador_aparicoes_no_anon"
  ON busca_fornecedor.contador_aparicoes
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

GRANT SELECT ON TABLE busca_fornecedor.contador_aparicoes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.contador_aparicoes TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Comentários
-- ---------------------------------------------------------------------------
COMMENT ON POLICY "consultas_select_own" ON busca_fornecedor.consultas IS
  'Comprador autenticado lê apenas suas consultas (comprador = auth.uid()). Escrita de volume = service_role.';

COMMENT ON POLICY "aparicoes_select_own_comprador" ON busca_fornecedor.aparicoes IS
  'Comprador vê aparições ligadas a si ou às suas consultas. Anon bloqueado.';

COMMENT ON POLICY "usuario_comprador_select_own" ON busca_fornecedor.usuario_comprador IS
  'Perfil comprador: SELECT/UPDATE só do próprio id. Sem leitura cross-tenant.';
