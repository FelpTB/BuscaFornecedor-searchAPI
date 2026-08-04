# ADR 002 — Paridade MCP ↔ REST

## Status

Aceito

## Contexto

Agentes e apps HTTP devem obter os mesmos resultados e configuração.

## Decisão

- Cada endpoint de negócio tem tool MCP com o mesmo contrato semântico.
- MCP usa Zod; REST valida no service (evoluir para schema compartilhado se necessário).
- Transport: Streamable HTTP em `/mcp`.

## Consequências

- Smoke `npm run test:mcp` cobre o caminho MCP.
- Auth futura deve proteger ambos os canais.
