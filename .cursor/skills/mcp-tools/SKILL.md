---
name: mcp-tools
description: Creates and maintains MCP Streamable HTTP tools for BuscaFornecedor. Use when editing src/mcp, registering tools, Zod schemas, or MCP parity with REST.
---

# MCP Tools Expert

## Padrão

```js
server.registerTool(
  "tool_name",
  {
    title: "...",
    description: "...", // claro para agentes
    inputSchema: { /* Zod */ },
    annotations: { readOnlyHint: true }, // se aplicável
  },
  async (args) => {
    const result = await serviceFn(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);
```

## Regras

1. Tool chama o **mesmo** service da rota HTTP.
2. Zod em todo input; descrições em português ou EN consistentes com tools existentes.
3. Auth MCP = mesma política do REST quando implementada.
4. Smoke: `npm run test:mcp`.
5. Sessões in-memory — não assumir multi-instância sem redesign.

## Visão GUIA

Tools async mínimas (create/status/result) são **futuro** (ADR 007). Não substituir `search_text` sem tarefa explícita.

## Refs

`docs/mcp.md`, ADR 002
