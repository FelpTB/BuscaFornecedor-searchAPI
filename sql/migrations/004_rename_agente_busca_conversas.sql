-- =============================================================================
-- Migration: rename conversas/mensagens → nomes identificáveis do agente
--   conversas  → agente_busca_conversas
--   mensagens  → agente_busca_mensagens
--
-- Rollback:
--   ALTER TABLE busca_fornecedor.agente_busca_mensagens RENAME TO mensagens;
--   ALTER TABLE busca_fornecedor.agente_busca_conversas RENAME TO conversas;
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'busca_fornecedor' AND table_name = 'conversas'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'busca_fornecedor' AND table_name = 'agente_busca_conversas'
  ) THEN
    ALTER TABLE busca_fornecedor.conversas RENAME TO agente_busca_conversas;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'busca_fornecedor' AND table_name = 'mensagens'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'busca_fornecedor' AND table_name = 'agente_busca_mensagens'
  ) THEN
    ALTER TABLE busca_fornecedor.mensagens RENAME TO agente_busca_mensagens;
  END IF;
END $$;

-- Índices (renomear se ainda com nome antigo)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'busca_fornecedor' AND c.relname = 'conversas_user_updated_idx'
  ) THEN
    ALTER INDEX busca_fornecedor.conversas_user_updated_idx
      RENAME TO agente_busca_conversas_user_updated_idx;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'busca_fornecedor' AND c.relname = 'mensagens_conversa_seq_idx'
  ) THEN
    ALTER INDEX busca_fornecedor.mensagens_conversa_seq_idx
      RENAME TO agente_busca_mensagens_conversa_seq_idx;
  END IF;
END $$;

COMMENT ON TABLE busca_fornecedor.agente_busca_conversas IS
  'Conversas do agente de busca (X-Ray/API/MCP). id = session_id do cliente.';

COMMENT ON TABLE busca_fornecedor.agente_busca_mensagens IS
  'Mensagens públicas das conversas do agente (user/assistant/tool).';

-- Recriar policies com nomes alinhados
DROP POLICY IF EXISTS "conversas_select_own" ON busca_fornecedor.agente_busca_conversas;
DROP POLICY IF EXISTS "conversas_no_anon" ON busca_fornecedor.agente_busca_conversas;
DROP POLICY IF EXISTS "agente_busca_conversas_select_own" ON busca_fornecedor.agente_busca_conversas;
DROP POLICY IF EXISTS "agente_busca_conversas_no_anon" ON busca_fornecedor.agente_busca_conversas;

CREATE POLICY "agente_busca_conversas_select_own"
  ON busca_fornecedor.agente_busca_conversas
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "agente_busca_conversas_no_anon"
  ON busca_fornecedor.agente_busca_conversas
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "mensagens_select_own" ON busca_fornecedor.agente_busca_mensagens;
DROP POLICY IF EXISTS "mensagens_no_anon" ON busca_fornecedor.agente_busca_mensagens;
DROP POLICY IF EXISTS "agente_busca_mensagens_select_own" ON busca_fornecedor.agente_busca_mensagens;
DROP POLICY IF EXISTS "agente_busca_mensagens_no_anon" ON busca_fornecedor.agente_busca_mensagens;

CREATE POLICY "agente_busca_mensagens_select_own"
  ON busca_fornecedor.agente_busca_mensagens
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM busca_fornecedor.agente_busca_conversas c
      WHERE c.id = agente_busca_mensagens.conversa_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "agente_busca_mensagens_no_anon"
  ON busca_fornecedor.agente_busca_mensagens
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.agente_busca_conversas TO service_role;
GRANT SELECT ON TABLE busca_fornecedor.agente_busca_conversas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.agente_busca_mensagens TO service_role;
GRANT SELECT ON TABLE busca_fornecedor.agente_busca_mensagens TO authenticated;
