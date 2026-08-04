# Qdrant e busca híbrida

## Algoritmo: dual-path-rrf-v5

1. Embeddings por dimensão (`embeddings.js`, modelo `text-embedding-3-small`)
2. **Path A:** BM25-first → dense no pool prefetch
3. **Path B:** Dense-first + modificador BM25
4. Fusão **RRF** (`RRF_K`, default 10)
5. Post-process `filter_not` (full-text pode ser client-side)
6. Rerank LLM opcional (`llmRerank.js`)

Código: `src/multiVectorSearch.js` + orquestração em `searchService.js`.

## Env crítico

| Variável | Papel |
|----------|--------|
| `QDRANT_KEY` / `CLUSTER_ENDPOINT` / `COLLECTION_NAME` | Cluster |
| `QDRANT_DIMENSION_KEYS` | Chaves lógicas (produto, servico, …) |
| `QDRANT_VECTOR_NAMES` | Nomes 1:1 dos vetores na coleção |
| `QDRANT_PAYLOAD_KEYS` | Filtros keyword |
| `QDRANT_PAYLOAD_KEYS_TEXT` | Filtros full-text |
| `QDRANT_BM25_*` | Vetor/modelo/payload BM25 |
| `RRF_K` | Constante RRF |

Ver `.env.example`.

## Filtros

- OR dentro da mesma chave; AND entre chaves.
- Só chaves allowlisted.
- Keyword: match exato (normalização via `normalizeKeyword.js`).
- Full-text: `match.text` / predicados pós-busca conforme implementação.

## Cliente

Lazy singleton + Proxy em `qdrantClient.js`. Não criar clientes ad-hoc nas rotas.
