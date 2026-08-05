-- =============================================================================
-- Migration: grants / notas pós api_keys (idempotente)
-- A maior parte dos grants já está em 001. Este arquivo reforça USAGE/ALL
-- e documenta que aparicoes + contador_aparicoes JÁ EXISTEM no live.
--
-- NÃO cria aparicoes nem aparicoes_cnpj_agg.
-- =============================================================================

GRANT USAGE ON SCHEMA busca_fornecedor TO postgres, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE busca_fornecedor.api_keys TO service_role;
GRANT SELECT ON TABLE busca_fornecedor.api_keys TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE busca_fornecedor.usuario_comprador TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE busca_fornecedor.consultas TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE busca_fornecedor.aparicoes TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE busca_fornecedor.contador_aparicoes TO service_role;

-- Sequência do contador (se existir)
DO $$
DECLARE
  seq text;
BEGIN
  SELECT pg_get_serial_sequence('busca_fornecedor.contador_aparicoes', 'id') INTO seq;
  IF seq IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', seq);
  END IF;
END $$;
