# ADR 005 — Autenticação por API key

## Status

Proposto (Fase 1 do PLANO)

## Contexto

Stub atual não autentica. Plataforma multi-tenant precisa ligar chamadas a `user`/`org`.

## Decisão

- API keys `sk_live_…` com hash SHA-256 em Supabase; header `Authorization: Bearer` ou `X-Api-Key`.
- Cache Redis/memória `hash → { user_id, org_id, plan }`.
- Mesmo middleware para REST e MCP.
- Shape `req.auth` já reservada.

## Consequências

- Sem key → 401. Key inválida/revogada → 401/403.
- Segredo nunca em log (só prefixo).
