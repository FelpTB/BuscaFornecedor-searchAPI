---
name: railway-deploy
description: Deploys and configures BuscaFornecedor on Railway. Use when changing railway.toml, env vars, healthchecks, multi-service workers, or production rollout.
---

# Railway Deploy Expert

## Fatos

- `railway.toml` + Nixpacks + `npm start`
- Health: `/health`
- Não setar `PORT` manualmente
- Uma instância: sessões MCP in-memory OK

## Checklist release

1. Vars obrigatórias no painel (ver `docs/deployment.md`)
2. Healthcheck verde
3. Smoke REST + MCP no domínio público
4. Worker (quando existir): serviço separado, env Redis/Supabase

Não commitar `.env` / `.railway/` com secrets.
