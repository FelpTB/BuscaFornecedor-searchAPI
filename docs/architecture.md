# Arquitetura — BuscaFornecedor API + MCP

## Estado atual (v1)

Aplicação **Node.js ESM** no Railway que expõe:

1. **REST** — `GET /health`, `GET /config`, `POST /search/text`
2. **MCP Streamable HTTP** — `/mcp` com tools `get_config`, `search_text`

Núcleo compartilhado: `searchService.executeSearchByText` → embeddings OpenAI + dual-path RRF + rerank LLM opcional.

```
Clients (HTTP / agentes MCP)
        │
        ▼
app.js
  requestId → JSON → /health (público)
        │
  ├─ routes + auth (AUTH_MODE) → Zod → searchService
  └─ /mcp + auth alinhada → tools → searchService
        │
        ▼
  embeddings + multiVectorSearch + llmRerank → Qdrant
```

## Responsabilidades por pasta

| Path | Papel |
|------|--------|
| `src/server.js` | Boot, validateEnv, listen, shutdown |
| `src/app.js` | Factory Express (middleware em ordem) |
| `src/config/env.js` | Defaults, limites, AUTH_MODE, boot check |
| `src/schemas/searchText.js` | Zod compartilhado REST↔MCP |
| `src/middleware/` | auth pluggable, requestId, errorHandler |
| `src/errors/AppError.js` | Erros tipados |
| `src/routes/` | Portas HTTP — validam e delegam |
| `src/searchService.js` | Regras de busca e contrato público |
| `src/multiVectorSearch.js` | Algoritmo dual-path RRF |
| `src/mcp/` | Tools + transport Streamable HTTP |

## Princípios

1. Portas não embutem lógica de busca.
2. Paridade REST ↔ MCP via serviço único + schema único.
3. Hot path síncrono; telemetria futura no cold path (PLANO).
4. Auth pluggable (`off` → `api_key` → Supabase) sem mudar `req.auth`.
5. `search_id` + `X-Request-Id` para rastreio.

## Evolução

- **Curto prazo:** [`PLANO_ESCALAVEL.md`](PLANO_ESCALAVEL.md) — API keys hash, Redis/BullMQ, Supabase.
- **Longo prazo:** [`GUIA_IMPLEMENTACAO.md`](GUIA_IMPLEMENTACAO.md) — busca async, regional/nacional.
- **APIs de suporte:** [`support-apis.md`](support-apis.md).

Decisões: [`../adr/`](../adr/).
