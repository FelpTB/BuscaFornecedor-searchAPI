-- =============================================================================
-- Migration: api_keys para autenticação da API+MCP (BuscaFornecedor)
-- Projeto: abcAdvise (hccolkrnyrxcbxuuajwq)
-- Schema live: busca_fornecedor
--
-- Contexto (introspecção 2026-08-05):
--   • auth.users = identidade
--   • usuario_comprador / usuario_fornecedor / app_admins = perfis
--   • consultas = histórico de buscas (já existe)
--   • aparicoes = JÁ EXISTE (~137k rows) com cnpj_basico/ordem/dv — NÃO recriar
--   • contador_aparicoes = JÁ EXISTE (agg por CNPJ básico) — NÃO criar aparicoes_cnpj_agg
--   • api_keys = AUSENTE → esta migration cria
--
-- Rollback:
--   DROP TABLE IF EXISTS busca_fornecedor.api_keys;
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS busca_fornecedor.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'default',
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['search']::text[],
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT api_keys_key_hash_unique UNIQUE (key_hash)
);

COMMENT ON TABLE busca_fornecedor.api_keys IS
  'API keys hasheadas (sk_bf_…) para agentes/MCP/X-Ray. Plaintext nunca é persistido.';

COMMENT ON COLUMN busca_fornecedor.api_keys.key_prefix IS
  'Prefixo público para exibição (ex.: sk_bf_xxxxxx), não é secreto.';

COMMENT ON COLUMN busca_fornecedor.api_keys.key_hash IS
  'SHA-256 hex da key plaintext.';

CREATE INDEX IF NOT EXISTS api_keys_user_id_active_idx
  ON busca_fornecedor.api_keys (user_id)
  WHERE active = true AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS api_keys_key_hash_active_idx
  ON busca_fornecedor.api_keys (key_hash)
  WHERE active = true AND revoked_at IS NULL;

-- RLS: backend usa service_role (bypass). Policies defensivas para roles de cliente.
ALTER TABLE busca_fornecedor.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_keys_select_own" ON busca_fornecedor.api_keys;
CREATE POLICY "api_keys_select_own"
  ON busca_fornecedor.api_keys
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "api_keys_no_anon" ON busca_fornecedor.api_keys;
CREATE POLICY "api_keys_no_anon"
  ON busca_fornecedor.api_keys
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- Grants (PostgREST + service_role). service_role bypassa RLS.
GRANT USAGE ON SCHEMA busca_fornecedor TO postgres, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.api_keys TO service_role;
GRANT SELECT ON TABLE busca_fornecedor.api_keys TO authenticated;

-- Garante acesso de serviço às tabelas que a API já usa
GRANT SELECT, INSERT, UPDATE ON TABLE busca_fornecedor.usuario_comprador TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE busca_fornecedor.consultas TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE busca_fornecedor.aparicoes TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE busca_fornecedor.contador_aparicoes TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA busca_fornecedor
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
