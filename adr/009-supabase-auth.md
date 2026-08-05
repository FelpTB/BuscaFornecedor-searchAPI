# ADR 009 — Auth via Supabase (users existentes)

## Status

Superseded em parte por [ADR 010](010-supabase-hybrid-auth-telemetry.md) (modelo híbrido). JWT Supabase permanece um dos providers.

## Contexto

A API+MCP precisa autenticar contra o mesmo universo de usuários do produto BuscaFornecedor. O Supabase live (`abcAdvise`) já tem `auth.users` + `busca_fornecedor.usuario_comprador` / `usuario_fornecedor` / `app_admins`. Não há `api_keys` nem `organizations`.

## Decisão

1. Autenticar a API com **JWT Supabase** (`Authorization: Bearer <access_token>`) como um dos modos.
2. Resolver papéis e cotas a partir das tabelas `usuario_*` e `app_admins` (ver `docs/supabase-users.md`).
3. Manter `req.auth` estável; estender com `roles`, `tierBusca`, quotas.
4. `api_keys` (hash) para agentes MCP — ver ADR 010 / plano.
5. Não inventar `org_id` até existir modelo de organização no banco.

## Consequências

- `AUTH_MODE` inclui `supabase_jwt` junto de `api_key` (hash) — ver ADR 010.
- Service role restrito ao backend para lookups.