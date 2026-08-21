-- Migration: cota e identificação das buscas do agente
--   1) Sobe limite_buscas de contas Agente/X-Ray/AgentUI (default 50 bloqueava persistência).
--   2) Comentário em consultas.origem: 'agente' = UI do assistente; 'xray' = harness QA.
--
-- Rollback:
--   UPDATE busca_fornecedor.usuario_comprador
--      SET limite_buscas = 50
--    WHERE fonte IN ('Agente', 'X-Ray', 'AgentUI') AND limite_buscas = 500;

UPDATE busca_fornecedor.usuario_comprador
   SET limite_buscas = GREATEST(COALESCE(limite_buscas, 0), 500)
 WHERE fonte IN ('Agente', 'X-Ray', 'AgentUI', 'agent-ui');

COMMENT ON COLUMN busca_fornecedor.consultas.origem IS
  'Canal da busca: site | whatsapp | xray (harness QA) | agente (UI do assistente) | api | mcp.';

COMMENT ON COLUMN busca_fornecedor.usuario_comprador.fonte IS
  'Canal de cadastro: Site | WhatsApp | Agente (assistente/X-Ray/AgentUI) | API.';
