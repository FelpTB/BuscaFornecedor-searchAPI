# Support API — Qdrant Request API

| | |
|--|--|
| **Live** | https://qdrantrequestapi-buscafornecedor.up.railway.app/ |
| **GitHub** | https://github.com/FelpTB/Qdrant_Request_API |
| **Stack** | Node ≥18 ESM · Express · Qdrant · OpenAI · MCP · **pg** |
| **Package** | `qdrant-busca-api` |
| **Auth** | Nenhuma |

## Propósito

Plataforma **completa**: indexação (Postgres → embeddings → Qdrant) **e** busca híbrida multi-vetorial + MCP. Ancestral/fuller da searchAPI.

Health live: `{ "status":"ok", "mcp":"/mcp", "search_xray":"/search/xray" }`.

## Estrutura `src/`

| Módulo | Papel |
|--------|--------|
| `server.js` | Rotas REST + orquestração search |
| `multiVectorSearch.js` | dual-path-rrf-v5 |
| `pipeline.js` | fetch → transform → embed → upsert → mark |
| `fetchCompanyProfiles.js` / `transformProfile.js` / `upsertPoints.js` / `markVectorized.js` | Pipeline |
| `db.js` | Pool Postgres (`DB_URL`) |
| `searchByQuery.js` | Busca single/multi collection |
| `searchAgent.js` + `searchXrayHtml.js` | UI/agente X-Ray |
| `mcp/` | Tools `get_config`, `search_text` |

## Endpoints HTTP

### Busca

| Método | Path | Notas |
|--------|------|-------|
| GET | `/health` | Liveness |
| GET | `/config` | Dimensões, filtros, BM25, dual-path, MCP |
| POST | `/search` | Cliente envia **vetores** já embedados |
| POST | `/search/text` | Texto → OpenAI → dual-path RRF |
| POST | `/search/collection` | Como `/search` + `collection` no body |
| POST | `/search/query` | Collection nomeada; single ou multi |
| POST | `/search/validate-filter` | Scroll só com filter |
| GET | `/search/xray` | UI HTML |
| POST | `/search/xray/run` | Agente LLM monta args e busca |

### Indexação / admin

| Método | Path | Notas |
|--------|------|-------|
| POST | `/points/upsert` | Batch upsert (body até ~50MB) |
| POST | `/points/insert` | Point único + collection |
| POST | `/company-profiles/mark-vectorized` | `qdrant=true` no PG |
| POST | `/pipeline/run` | **202** job async `{ limit }` |
| GET | `/pipeline/status` | Estado JSON |
| GET | `/pipeline/stream` | SSE |
| GET | `/pipeline/dashboard` | HTML métricas |

### MCP

`POST/GET/DELETE /mcp` — tools `get_config`, `search_text` (mesmo núcleo de `/search/text`).

## Algoritmo de busca

**dual-path-rrf-v5** (igual à searchAPI):

1. BM25 sparse + dense multi-vector em paralelo  
2. Path A BM25-first · Path B Dense-first + modifier  
3. Merge RRF (`rrf_k` merge = 10)  
4. `filter_not` pós-processado  
5. Rerank LLM opcional (`gpt-4o-mini`)

Live config (amostra): BM25 ativo (`bm25_complete_profile`); dimensões `publico, produto, cliente, descricao, servico`.

## Pipeline de indexação

```
busca_fornecedor.company_profile (qdrant IS NOT true)
  → transformProfile (5 textos + payload + bm25Text)
  → OpenAI embeddings (só filledVectorKeys)
  → upsert Qdrant (point id = CNPJ)
  → mark qdrant=true
```

## Env crítico

`QDRANT_*`, `OPENAI_API_KEY`, `DB_URL`, knobs BM25/RRF/pipeline — ver `.env.example` do repo.

## Vs searchAPI / este workspace

| | Qdrant_Request | searchAPI / Main |
|--|----------------|------------------|
| Busca `/search/text` + MCP | Sim | Sim |
| `/search` com vetores crus | Sim | Não |
| Pipeline + Postgres | Sim | Não |
| X-Ray / dashboard | Sim | Não |
| Estrutura | Lógica em `server.js` | `searchService` + routes |

**Uso recomendado na API completa:** manter **ingest** aqui (ou extrair worker); expor **busca** ao produto via searchAPI/este repo (contrato mais limpo).

## Alerta live

`GET /config` retornou `vector_names` com possível swap `publico↔cliente`. Conferir env `QDRANT_DIMENSION_KEYS` / `QDRANT_VECTOR_NAMES` no Railway antes de calibrar pesos.
