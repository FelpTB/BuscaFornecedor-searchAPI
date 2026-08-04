---
name: qdrant-search
description: Works on hybrid Qdrant dual-path RRF search, filters, weights, BM25, and embeddings. Use when changing multiVectorSearch, searchService, qdrantClient, embeddings, or ranking behavior.
---

# Qdrant Search Expert

## Algoritmo

`dual-path-rrf-v5` — ver `docs/qdrant.md` e ADR 004.

## Ao alterar ranking

1. Ler `multiVectorSearch.js` e o contrato de `executeSearchByText`.
2. Manter allowlist de filtros.
3. Pesos: normalização soma 1.0 (incluir `bm25` se híbrido).
4. Env 1:1 `QDRANT_DIMENSION_KEYS` ↔ `QDRANT_VECTOR_NAMES`.
5. Atualizar `docs/qdrant.md` / `getPublicConfig` se expor meta nova.
6. Não escrever em Postgres/Redis no hot path.

## Cliente

Usar `qdrantClient.js` (lazy). Não instanciar `QdrantClient` nas rotas.

## Teste

Busca manual + `npm run test:mcp` com query conhecida.
