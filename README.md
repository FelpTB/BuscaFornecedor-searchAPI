# BuscaFornecedor API + MCP

API + MCP de busca híbrida B2B (Qdrant + OpenAI + Supabase), deploy Railway.

**Documentação:** Notion Document Hub → *Documentação Técnica SearchAPI + MCP (Railway)*  
**Código = verdade operacional.** Planejamento de produto = Notion Roadmap (Fase 1).

## Quick start

```bash
cp .env.example .env
npm install
npm start
```

| Endpoint | Função |
|----------|--------|
| `GET /health` | Health |
| `GET /config` | Config pública |
| `POST /search/text` | Busca (auth conforme `AUTH_MODE`) |
| `/mcp` | MCP Streamable HTTP (`search_text`, `get_config`) |
| `GET /search/xray` | Harness QA (desligar: `XRAY_ENABLED=0`) |

```bash
npm test
npm run test:mcp -- "energia solar"
```

## Estrutura

```
src/
  server.js / app.js
  config/          # env + feature flags
  searchService.js # núcleo de busca (REST = MCP)
  search/          # fallback + display
  auth/ telemetry/ comms/
  clients/         # cities + notificacao
  mcp/ xray/
  db/ repositories/
sql/migrations/
.cursor/           # rules + skills (agente)
AGENTS.md
```

## Produção (checklist Railway)

1. `AUTH_MODE=api_key,supabase_jwt` + `SUPABASE_*` + `DATABASE_URL` (mesmo projeto)
2. `TELEMETRY_MODE=inline`
3. `NOTIFICACAO_API_URL` + `NOTIFICACAO_API_KEY` + `NOTIFICACAO_MODE=on`
4. Notificação: `POSTGRES_SCHEMA=busca_fornecedor`
5. Opcional: `XRAY_ENABLED=0` se não quiser o harness público
6. `REQUIRE_COMPRADOR=1` quando o front exigir perfil

Envio e-mail/SMS (claim/cron) permanece no **n8n** + notificacao-clientes — a API só orquestra a fila (`recebe-consulta`).
