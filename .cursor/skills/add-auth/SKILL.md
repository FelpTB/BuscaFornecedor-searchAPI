---
name: add-auth
description: Implements hybrid auth (API key hash + Supabase JWT) for REST and MCP per ADR 010. Use when the user invokes /add-auth or asks to add authentication.
disable-model-invocation: true
---

# /add-auth

Seguir [`docs/plano-supabase-auth.md`](../../../docs/plano-supabase-auth.md) Fase S1 e ADR 010.  
Skill DB: `supabase-db`.

## Entregar

1. SQL `busca_fornecedor.api_keys` (ver skill `supabase-db` / reference.md)
2. `src/auth/*` — hash lookup, JWT Supabase, cache TTL, shape `req.auth` estendido
3. Substituir stub em `middleware/auth.js` (`AUTH_MODE=api_key,supabase_jwt`)
4. `register_buyer` + `issue_api_key` (REST e tools X-Ray)
5. Gate comprador (`REQUIRE_COMPRADOR`)
6. Mesmo contrato no MCP (Bearer / X-Api-Key)
7. 401/403 padronizados
8. Atualizar `.env.example`, `docs/security.md`, `docs/api.md`
9. Testes: sem credencial → 401; key/JWT válidos → `userId` preenchido

## Nunca

- Guardar key em claro
- Logar key/JWT completo
- Auth só no REST
- Service role no cliente
