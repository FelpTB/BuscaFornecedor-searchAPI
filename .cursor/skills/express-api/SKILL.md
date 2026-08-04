---
name: express-api
description: Implements and extends Express REST routes for BuscaFornecedor. Use when adding endpoints, middleware, HTTP validation, or changing src/routes, src/server.js, or src/middleware.
---

# Express API Expert

## Stack

Node 20+ ESM, Express 4, `src/server.js` + `src/routes/index.js`.

## Checklist para novo endpoint

1. Lógica no **service** (`searchService.js` ou módulo de domínio novo).
2. Rota só: parse → chama service → status/JSON.
3. Proteger com `authMiddleware` (mesmo stub).
4. Criar tool MCP espelhada (`mcp-tools` / `/new-endpoint`).
5. Atualizar `docs/api.md` e README se contrato público mudar.
6. Erros com `err.status` / `err.statusCode`.

## Anti-padrões

- SQL, OpenAI ou Qdrant direto na rota
- Duplicar lógica já existente no MCP
- Aumentar body limit sem motivo
- Logar secrets

## Referências

- `docs/api.md`, `docs/architecture.md`
- ADR 001, 002
