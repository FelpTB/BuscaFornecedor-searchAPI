-- Migration: api_keys + aparicoes (+ agg)
-- Schema: busca_fornecedor
-- Rollback: DROP TABLE IF EXISTS busca_fornecedor.aparicoes_cnpj_agg, busca_fornecedor.aparicoes, busca_fornecedor.api_keys;

CREATE TABLE IF NOT EXISTS busca_fornecedor.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'default',
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['search']::text[],
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS api_keys_user_id_idx
  ON busca_fornecedor.api_keys (user_id)
  WHERE active = true AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS busca_fornecedor.aparicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id uuid NOT NULL REFERENCES busca_fornecedor.consultas(id) ON DELETE CASCADE,
  comprador_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cnpj text NOT NULL,
  nome_empresa text,
  posicao int,
  score_final numeric,
  cidade text,
  uf text,
  origem text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aparicoes_cnpj_created_idx
  ON busca_fornecedor.aparicoes (cnpj, created_at DESC);
CREATE INDEX IF NOT EXISTS aparicoes_consulta_idx
  ON busca_fornecedor.aparicoes (consulta_id);
CREATE INDEX IF NOT EXISTS aparicoes_comprador_idx
  ON busca_fornecedor.aparicoes (comprador_id, created_at DESC);

CREATE TABLE IF NOT EXISTS busca_fornecedor.aparicoes_cnpj_agg (
  cnpj text PRIMARY KEY,
  total bigint NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
