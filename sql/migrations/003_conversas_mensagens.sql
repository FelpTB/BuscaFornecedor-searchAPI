-- =============================================================================
-- Migration: agente_busca_conversas + agente_busca_mensagens
-- (histórico de chat autenticado do agente de busca)
--
-- Rollback:
--   DROP TABLE IF EXISTS busca_fornecedor.agente_busca_mensagens;
--   DROP TABLE IF EXISTS busca_fornecedor.agente_busca_conversas;
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS busca_fornecedor.agente_busca_conversas (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid REFERENCES busca_fornecedor.api_keys(id) ON DELETE SET NULL,
  key_prefix text,
  title text,
  source text NOT NULL DEFAULT 'xray',
  last_search_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agente_busca_conversas_source_check CHECK (source IN ('xray', 'api', 'mcp'))
);

COMMENT ON TABLE busca_fornecedor.agente_busca_conversas IS
  'Conversas do agente de busca (X-Ray/API/MCP). id = session_id do cliente.';

COMMENT ON COLUMN busca_fornecedor.agente_busca_conversas.key_prefix IS
  'Prefixo da API key usada (nunca plaintext).';

COMMENT ON COLUMN busca_fornecedor.agente_busca_conversas.last_search_id IS
  'Último search_id associado (consultas.id), se houver.';

CREATE INDEX IF NOT EXISTS agente_busca_conversas_user_updated_idx
  ON busca_fornecedor.agente_busca_conversas (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS busca_fornecedor.agente_busca_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL REFERENCES busca_fornecedor.agente_busca_conversas(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  seq int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agente_busca_mensagens_role_check CHECK (role IN ('user', 'assistant', 'tool')),
  CONSTRAINT agente_busca_mensagens_conversa_seq_unique UNIQUE (conversa_id, seq)
);

COMMENT ON TABLE busca_fornecedor.agente_busca_mensagens IS
  'Mensagens públicas das conversas do agente (user/assistant/tool). metadata pode trazer search_id + results resumidos.';

CREATE INDEX IF NOT EXISTS agente_busca_mensagens_conversa_seq_idx
  ON busca_fornecedor.agente_busca_mensagens (conversa_id, seq);

ALTER TABLE busca_fornecedor.agente_busca_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE busca_fornecedor.agente_busca_mensagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agente_busca_conversas_select_own" ON busca_fornecedor.agente_busca_conversas;
CREATE POLICY "agente_busca_conversas_select_own"
  ON busca_fornecedor.agente_busca_conversas
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "agente_busca_conversas_no_anon" ON busca_fornecedor.agente_busca_conversas;
CREATE POLICY "agente_busca_conversas_no_anon"
  ON busca_fornecedor.agente_busca_conversas
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "agente_busca_mensagens_select_own" ON busca_fornecedor.agente_busca_mensagens;
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

DROP POLICY IF EXISTS "agente_busca_mensagens_no_anon" ON busca_fornecedor.agente_busca_mensagens;
CREATE POLICY "agente_busca_mensagens_no_anon"
  ON busca_fornecedor.agente_busca_mensagens
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

GRANT USAGE ON SCHEMA busca_fornecedor TO postgres, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.agente_busca_conversas TO service_role;
GRANT SELECT ON TABLE busca_fornecedor.agente_busca_conversas TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.agente_busca_mensagens TO service_role;
GRANT SELECT ON TABLE busca_fornecedor.agente_busca_mensagens TO authenticated;
