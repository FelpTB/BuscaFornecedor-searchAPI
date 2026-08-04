# ADR 001 — Serviço compartilhado de busca

## Status

Aceito

## Contexto

A API precisa expor a mesma busca via REST e MCP sem divergência de comportamento.

## Decisão

Toda lógica de busca vive em `searchService.js` (`executeSearchByText`, `getPublicConfig`). Rotas HTTP e tools MCP apenas delegam.

## Consequências

- Um bugfix corrige ambos os canais.
- Novos endpoints de negócio exigem tool MCP correspondente.
- Proibido reimplementar embed/Qdrant dentro de `routes/` ou `mcp/`.
