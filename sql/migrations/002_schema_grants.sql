-- Migration: grants no schema busca_fornecedor para a API (service_role)
-- Necessário para PostgREST/Supabase JS: .schema('busca_fornecedor').from(...)
-- Também: Dashboard → Settings → API → Exposed schemas → incluir "busca_fornecedor"
--
-- Erro típico sem isto:
--   permission denied for table usuario_comprador
--   permission denied for table api_keys

GRANT USAGE ON SCHEMA busca_fornecedor TO postgres, anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA busca_fornecedor TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA busca_fornecedor TO postgres, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA busca_fornecedor TO postgres, service_role;

-- Leitura/escrita básica para roles autenticadas (ajuste RLS depois se necessário)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA busca_fornecedor TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA busca_fornecedor TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA busca_fornecedor
  GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA busca_fornecedor
  GRANT ALL ON SEQUENCES TO postgres, service_role;

-- Garante privilégios nas tabelas críticas da API+MCP
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  busca_fornecedor.usuario_comprador
TO service_role, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  busca_fornecedor.api_keys
TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  busca_fornecedor.consultas
TO service_role, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'busca_fornecedor' AND table_name = 'aparicoes'
  ) THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.aparicoes TO service_role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'busca_fornecedor' AND table_name = 'aparicoes_cnpj_agg'
  ) THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.aparicoes_cnpj_agg TO service_role';
  END IF;
END $$;
