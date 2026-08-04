---
name: add-auth
description: Implements Fase 1 API key authentication for REST and MCP. Use when the user invokes /add-auth or asks to add API key auth.
disable-model-invocation: true
---

# /add-auth

Seguir ADR 005 e `docs/PLANO_ESCALAVEL.md` Fase 1.

## Entregar

1. Schema SQL `api_keys` (+ orgs/profiles se necessário) — ver PLANO §3
2. `src/auth/apiKey.js` — hash lookup, cache TTL, shape `req.auth`
3. Substituir stub em `middleware/auth.js`
4. Proteger mount MCP com o mesmo contrato (Bearer / X-Api-Key)
5. 401/403 padronizados
6. Atualizar `.env.example`, `docs/security.md`, `docs/api.md`
7. Testes: sem key → 401; key válida → busca OK (REST + MCP)

## Nunca

- Guardar key em claro
- Logar key completa
- Auth só no REST
