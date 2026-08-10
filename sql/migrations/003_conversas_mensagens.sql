-- =============================================================================
-- Migration: conversas + mensagens (histórico de chat autenticado)
-- Schema: busca_fornecedor
--
-- Rollback:
--   DROP TABLE IF EXISTS busca_fornecedor.mensagens;
--   DROP TABLE IF EXISTS busca_fornecedor.conversas;
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS busca_fornecedor.conversas (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid REFERENCES busca_fornecedor.api_keys(id) ON DELETE SET NULL,
  key_prefix text,
  title text,
  source text NOT NULL DEFAULT 'xray',
  last_search_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversas_source_check CHECK (source IN ('xray', 'api', 'mcp'))
);

COMMENT ON TABLE busca_fornecedor.conversas IS
  'Conversas de chat do agente (X-Ray/API/MCP). id = session_id do cliente.';

COMMENT ON COLUMN busca_fornecedor.conversas.key_prefix IS
  'Prefixo da API key usada (nunca plaintext).';

COMMENT ON COLUMN busca_fornecedor.conversas.last_search_id IS
  'Último search_id associado (consultas.id), se houver.';

CREATE INDEX IF NOT EXISTS conversas_user_updated_idx
  ON busca_fornecedor.conversas (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS busca_fornecedor.mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL REFERENCES busca_fornecedor.conversas(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  seq int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mensagens_role_check CHECK (role IN ('user', 'assistant', 'tool')),
  CONSTRAINT mensagens_conversa_seq_unique UNIQUE (conversa_id, seq)
);

COMMENT ON TABLE busca_fornecedor.mensagens IS
  'Mensagens públicas da conversa (user/assistant/tool). metadata pode trazer search_id + results resumidos.';

CREATE INDEX IF NOT EXISTS mensagens_conversa_seq_idx
  ON busca_fornecedor.mensagens (conversa_id, seq);

-- RLS: backend usa service_role (bypass). Policies defensivas para cliente.
ALTER TABLE busca_fornecedor.conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE busca_fornecedor.mensagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversas_select_own" ON busca_fornecedor.conversas;
CREATE POLICY "conversas_select_own"
  ON busca_fornecedor.conversas
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "conversas_no_anon" ON busca_fornecedor.conversas;
CREATE POLICY "conversas_no_anon"
  ON busca_fornecedor.conversas
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "mensagens_select_own" ON busca_fornecedor.mensagens;
CREATE POLICY "mensagens_select_own"
  ON busca_fornecedor.mensagens
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM busca_fornecedor.conversas c
      WHERE c.id = mensagens.conversa_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "mensagens_no_anon" ON busca_fornecedor.mensagens;
CREATE POLICY "mensagens_no_anon"
  ON busca_fornecedor.mensagens
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

GRANT USAGE ON SCHEMA busca_fornecedor TO postgres, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.conversas TO service_role;
GRANT SELECT ON TABLE busca_fornecedor.conversas TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.mensagens TO service_role;
GRANT SELECT ON TABLE busca_fornecedor.mensagens TO authenticated;
