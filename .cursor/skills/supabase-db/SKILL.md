---
name: supabase-db
description: >-
  Operações seguras com Supabase/Postgres no BuscaFornecedor API+MCP: schema
  busca_fornecedor, auth.users, api_keys, consultas, aparicoes, pools, RLS e
  writes async. Use when working with Supabase, Postgres, migrations, consultas,
  aparições, comprador profiles, DATABASE_URL, service role, or telemetry writers.
---

# Supabase / Database (BuscaFornecedor)

## Quando usar

Qualquer tarefa que toque em:

- Supabase Auth / JWT / API keys ligadas a `auth.users`
- Tabelas `busca_fornecedor.*` (`usuario_comprador`, `consultas`, `api_keys`, `aparicoes`)
- Migrations SQL, pools, service role, telemetria async
- Onboarding de comprador ou histórico de busca

**Plano canônico:** [`docs/plano-supabase-auth.md`](../../../docs/plano-supabase-auth.md)  
**Inventário live:** [`docs/supabase-users.md`](../../../docs/supabase-users.md)  
**Schema detalhado / SQL:** [reference.md](reference.md)

## Regras invioláveis

1. **Hot path não espera write** de histórico/aparições/cota — só enqueue.
2. **Service role só no servidor** (`SUPABASE_SERVICE_ROLE_KEY`). Nunca no HTML X-Ray, never no cliente MCP.
3. **Não logar** API key completa, JWT, service role, nem email em claro em nível `info`.
4. **Identidade = `auth.users.id`**. Busca de produto exige `usuario_comprador`.
5. **Preferir schema real** (`consultas`, `usuario_*`) antes de inventar tabelas do PLANO teórico (`organizations`, `searches`).
6. Antes de writer/migration: **introspectar** colunas live (ou ler `docs/supabase-users.md` + `reference.md`).
7. Writes de volume: **`pg` Pool via pooler** (`DATABASE_URL` porta **6543**), não abrir dezenas de conexões diretas 5432.
8. Idempotência: `consultas.id = search_id`; `ON CONFLICT DO NOTHING` / upsert controlado.

## Layout de código alvo

```
src/db/supabaseAdmin.js
src/db/pgPool.js
src/db/repositories/{comprador,apiKeys,consultas,aparicoes}Repo.js
src/auth/{resolveAuth,registerBuyer,issueApiKey,jwtSupabase,apiKeyHash}.js
src/telemetry/{events,enqueue,writers}.js
sql/migrations/00x_*.sql
```

## Checklist — nova operação de DB

```
- [ ] Li plano-supabase-auth.md § relevante
- [ ] Confirmei colunas/tabela (reference.md ou introspecção)
- [ ] Decidi: Auth Admin (supabase-js) vs SQL (pg Pool)
- [ ] Filtro explícito por user_id / consulta_id
- [ ] Sem secret em log; allowlist em jsonb de resultados
- [ ] Se for pós-busca: passa por enqueue, não await no request
- [ ] Teste de idempotência / conflito
- [ ] Atualizei docs/database.md ou supabase-users.md se schema mudou
```

## Auth (resumo)

| Provider | Header | Resolve |
|----------|--------|---------|
| API key | `Bearer sk_…` / `X-Api-Key` | `api_keys.key_hash` → `user_id` → comprador |
| Supabase JWT | `Bearer <access_token>` | `sub` → comprador |
| Entra (futuro) | Bearer Entra | `oid` → map → `auth.users.id` |

Shape `req.auth`: ver plano §3.2. Manter estável ao adicionar Entra.

Hash de key: SHA-256 (mínimo) ou Argon2id; guardar só `key_hash` + `key_prefix`.

## Telemetria

Evento `search.completed` → writer:

1. Upsert/`INSERT` `consultas` (params + resultados resumidos)
2. Insert batch `aparicoes`
3. `buscas_realizadas = buscas_realizadas + 1` no comprador (se insert consulta ok)
4. Upsert agg CNPJ (se existir)

`TELEMETRY_MODE=inline` (MVP) ou `bullmq` (multi-instância). Skill `/new-worker` para BullMQ.

## Onboarding comprador

1. Coletar: nome, email, telefone?, empresa?
2. `auth.admin.createUser` + insert `usuario_comprador` (`fonte` = `Agente` / `X-Ray`)
3. Emitir `api_keys` (plaintext 1x)
4. Agente guarda instrução de usar a key; buscas seguintes autenticadas

Rate-limit register. Não reexibir key depois.

## Migrations

- Arquivos em `sql/migrations/` com timestamp/ordem.
- Incluir índices (`cnpj`, `consulta_id`, `user_id`).
- Documentar rollback em comentário no SQL.
- Nunca dropar dados de `consultas` / `usuario_*` sem pedido explícito.

## Proibido

- Embutir service role no front
- `SELECT *` de payloads sensíveis para jsonb de histórico
- Bloquear resposta HTTP/MCP aguardando Postgres
- Criar `organizations` / `searches` sem ADR e necessidade real
- Usar `AUTH_MODE=off` em produção com `REQUIRE_COMPRADOR=1` sem exceção documentada

## Additional resources

- [reference.md](reference.md) — DDL alvo, mapeamento `consultas`, env
- [`docs/plano-supabase-auth.md`](../../../docs/plano-supabase-auth.md)
- ADR 010, 005, 006, 009
