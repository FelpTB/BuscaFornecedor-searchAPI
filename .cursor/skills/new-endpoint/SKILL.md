---
name: new-endpoint
description: Scaffold a new REST endpoint with shared service and MCP tool parity. Use when the user invokes /new-endpoint or asks to create a new API endpoint.
disable-model-invocation: true
---

# /new-endpoint

Crie um endpoint de negócio completo com parity MCP.

## Passos

1. **Service** — função pura de domínio em `searchService.js` ou `src/<domínio>Service.js`.
2. **Rota** — em `src/routes/index.js` (atrás de `authMiddleware`):
   - valida input mínimo
   - chama service
   - mapeia erros `status`/`statusCode`
3. **MCP tool** — em `createMcpServer.js`:
   - Zod `inputSchema`
   - mesma função de service
   - JSON no content
4. **Docs** — `docs/api.md` + `docs/mcp.md` (1 parágrafo cada).
5. **Smoke** — estender `scripts/test-mcp-sdk.mjs` se tool nova.
6. **Config pública** — se expuser capabilities, incluir em `getPublicConfig`.

## Não fazer

- Lógica só na rota ou só no MCP
- Quebrar contratos existentes sem versionar
