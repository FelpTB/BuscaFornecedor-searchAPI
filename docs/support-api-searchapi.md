# Support API — BuscaFornecedor-searchAPI

| | |
|--|--|
| **Live** | https://buscafornecedor-searchapi-buscafornecedor.up.railway.app/ |
| **GitHub** | https://github.com/FelpTB/BuscaFornecedor-searchAPI |
| **Stack** | Node ≥20 ESM · Express · Qdrant · OpenAI · MCP · Zod |
| **Package** | `busca-fornecedor-api-mcp` |
| **Auth** | Stub (`middleware/auth.js`) — sempre passa |

## Propósito

Fatia **search-only** extraída da Qdrant_Request_API: mesmo núcleo híbrido + parity REST↔MCP, sem pipeline/Postgres/X-Ray.

**Este workspace (`BuscaFornecedor-Api-Mcp-Main`) é a evolução documentada desse código** (+ `.cursor/`, `adr/`, docs de arquitetura).

## Endpoints (live)

| Método | Path | Notas |
|--------|------|-------|
| GET | `/health` | `{ status, mcp, search, uptime }` |
| GET | `/config` | dual-path-rrf-v5 + dimensões |
| POST | `/search/text` | Busca por texto |
| POST/GET/DELETE | `/mcp` | Tools `get_config`, `search_text` |

Raiz `/` → 404 (usar paths acima).

## Estrutura

```
src/
  server.js
  routes/index.js
  middleware/auth.js
  searchService.js          # executeSearchByText / getPublicConfig
  multiVectorSearch.js
  embeddings.js
  llmRerank.js
  qdrantClient.js
  mcp/createMcpServer.js
  mcp/mountMcp.js
docs/PLANO_ESCALAVEL.md
scripts/test-mcp-sdk.mjs
```

## Config live (amostra 2026-08-04)

- Dimensões: `produto, servico, descricao, publico, cliente`
- Vetores: `v_produto` … `v_cliente` (mapeamento coerente)
- BM25: **`vector_name: null`** neste deploy (híbrido lexical off)
- MCP auth: false
- LLM rerank: `gpt-4o-mini` disponível via flag

## Contrato `POST /search/text`

Campos: `query` (obrig.), `queries`, `weights`, `filter`/`filter_not`, `bm25_query`/`bm25`, `limit_per_vector`, `final_limit`, `rerank`.

Ver também `docs/api.md` e `docs/qdrant.md` neste repo.

## Papel na API completa

Base do **hot path de busca** do produto. Combinar com:

1. **API-busca-cidades** → filtro regional  
2. **Qdrant_Request_API** → ingestão / ops de índice  
3. Auth/cotas → `PLANO_ESCALAVEL.md`
