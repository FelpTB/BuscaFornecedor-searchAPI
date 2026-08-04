---
name: new-mcp-tool
description: Scaffold a new MCP tool with Zod schema and shared service call. Use when the user invokes /new-mcp-tool or asks only for a new MCP tool.
disable-model-invocation: true
---

# /new-mcp-tool

## Passos

1. Confirmar se já existe (ou deve existir) endpoint REST — se sim, reutilizar service.
2. Registrar tool em `src/mcp/createMcpServer.js` com Zod.
3. Annotations corretas (`readOnlyHint` se read-only).
4. Injetar deps via `createMcpServer(deps)` — não importar side-effects globais novos sem necessidade.
5. Atualizar `docs/mcp.md`.
6. Testar com `npm run test:mcp`.

Se a tool for de negócio sem rota: criar a rota na mesma PR (ADR 002).
