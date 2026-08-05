# Implementação — Auth + Supabase + X-Ray (S0–S3)

**Data:** 2026-08-05  
**Plano:** [`plano-supabase-auth.md`](plano-supabase-auth.md) · ADR 010  
**Status:** código entregue; requer migration SQL + secrets no Railway para operar end-to-end.

---

## O que foi implementado

### Identidade (critério 2.4)

- Auth híbrida: `AUTH_MODE=off|api_key|supabase_jwt` (csv)
- API keys hasheadas em `busca_fornecedor.api_keys` (`sk_bf_…`)
- JWT Supabase via `auth.getUser`
- Keys legado em `AUTH_API_KEYS` (env) ainda funcionam
- `req.auth` com `userId`, `provider`, `roles`, `comprador`
- Gate opcional `REQUIRE_COMPRADOR=1`

### Onboarding

- `POST /auth/register-buyer` e `POST /search/xray/auth/register` — conta nova + API key
- `POST /auth/login-buyer` e `POST /search/xray/auth/login` — conta existente (email+senha) + nova API key
- Emite API key **1x** por chamada
- Tools no chat: `register_buyer`, `login_buyer`, `get_my_profile`
- Requer `SUPABASE_ANON_KEY` (recomendado) para `signInWithPassword`

### Histórico + aparições (critérios 5 e 6)

- Após busca autenticada: enqueue `search.completed` (fire-and-forget)
- Writer → `consultas` (`id = search_id`) + `buscas_realizadas++`
- Writer → `aparicoes` + upsert `aparicoes_cnpj_agg`
- Pool `pg` (DATABASE_URL) ou fallback Supabase JS

### X-Ray

- Aba **Conta / Auth**: cadastro, usar chave, perfil, probes consulta/aparições
- Chat usa a chave do painel; agente guia cadastro
- Telemetria enfileirada nas buscas do chat/run/tool

---

## Como ligar (checklist)

1. Rodar migration: [`sql/migrations/001_api_keys_aparicoes.sql`](../sql/migrations/001_api_keys_aparicoes.sql) no Supabase SQL Editor
2. Railway / `.env`:
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_ANON_KEY` (login email+senha)
   - `DATABASE_URL` (pooler `:6543`) recomendado
   - `AUTH_MODE=api_key,supabase_jwt`
   - `REQUIRE_COMPRADOR=1` (produção)
   - `TELEMETRY_MODE=inline`
3. Abrir `/search/xray` → Conta → criar conta **ou** entrar com conta existente → colar key → conversar/buscar
4. Copiar `search_id` → probe “Ver consulta”

---

## Endpoints novos

| Método | Path |
|--------|------|
| POST | `/auth/register-buyer` |
| POST | `/auth/login-buyer` |
| GET | `/auth/me` |
| POST | `/auth/api-keys` |
| POST | `/auth/api-keys/revoke` |
| GET | `/auth/consultas/:searchId` |
| GET | `/auth/aparicoes/:cnpj` |
| GET | `/search/xray/auth/status` |
| POST | `/search/xray/auth/register` |
| POST | `/search/xray/auth/login` |
| GET | `/search/xray/auth/me` |
| POST | `/search/xray/auth/api-keys` |
| GET | `/search/xray/telemetry/consulta/:searchId` |
| GET | `/search/xray/telemetry/aparicoes/:cnpj` |

---

## Notion

Não há MCP Notion disponível neste ambiente Cursor. Para manter docs no Notion:

1. Cursor **Settings → MCP** → adicionar [Notion MCP](https://developers.notion.com/docs/mcp) (ou integração oficial Notion)
2. Ou exportar/copiar esta página + `plano-supabase-auth.md` + `aceitacao.md` para um database Notion
3. Guia rápido: [`notion-sync.md`](notion-sync.md)

---

## Arquivos principais

```
sql/migrations/001_api_keys_aparicoes.sql
src/db/supabaseAdmin.js, pgPool.js
src/db/repositories/{compradorRepo,consultasRepo}.js
src/auth/{apiKeyHash,resolveAuth,registerBuyer}.js
src/telemetry/enqueue.js
src/routes/index.js (auth + search + enqueue)
src/xray/{routes,xrayHtml,conversationalAgent}.js
```
