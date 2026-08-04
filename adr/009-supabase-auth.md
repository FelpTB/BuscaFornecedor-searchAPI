# ADR 009 — Auth via Supabase (users existentes)

## Status

Proposto

## Contexto

A API+MCP precisa autenticar contra o mesmo universo de usuários do produto BuscaFornecedor. O Supabase live (`abcAdvise`) já tem `auth.users` + `busca_fornecedor.usuario_comprador` / `usuario_fornecedor` / `app_admins`. Não há `api_keys` nem `organizations`.

## Decisão

1. Autenticar a API com **JWT Supabase** (`Authorization: Bearer <access_token>`).
2. Resolver papéis e cotas a partir das tabelas `usuario_*` e `app_admins` (ver `docs/supabase-users.md`).
3. Manter `req.auth` estável; estender com `roles`, `tierBusca`, quotas.
4. Tratar `api_keys` (hash) como evolução opcional para agentes MCP sem login interativo — exige migration.
5. Não inventar `org_id` até existir modelo de organização no banco.

## Consequências

- `AUTH_MODE=supabase_jwt` complementar a `off` / `api_key` (lista local).
- PLANO_ESCALAVEL schema teórico fica secundário ao schema real.
- Service role restrito ao backend para lookups.
