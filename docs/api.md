# API HTTP — v1

Base: `http://HOST:PORT` (default `3000`).

## Endpoints

| Método | Path | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/health` | Público | Liveness + `auth_mode` |
| GET | `/config` | Conforme `AUTH_MODE` | Dimensões, filtros, BM25, limites, auth |
| POST | `/search/text` | Conforme `AUTH_MODE` | Busca híbrida completa |
| POST/GET/DELETE | `/mcp` | Mesma política do REST | MCP Streamable HTTP |

Headers de correlação: `X-Request-Id` (ecoado), `X-Search-Id` na resposta de busca.

## Auth (`AUTH_MODE`)

| Valor | Comportamento |
|-------|----------------|
| `off` (default) | Bootstrap sem autenticação |
| `api_key` | Exige `Authorization: Bearer <key>` ou `X-Api-Key` ∈ `AUTH_API_KEYS` |

Espaço para Fase 1 PLANO (hash + Supabase) sem mudar o shape de `req.auth`.

## `POST /search/text`

| Campo | Obrigatório | Notas |
|-------|-------------|-------|
| `query` | Sim | Texto principal |
| `queries` | Não | Texto por dimensão |
| `weights` | Não | Soma = 1.0; default iguais |
| `filter` / `filter_not` | Não | Allowlist (ver `/config`) |
| `bm25_query` / `bm25` | Não | Híbrido BM25 |
| `limit_per_vector` | Não | 1–200, default 50 |
| `final_limit` | Não | 1–100, default 20 |
| `rerank` | Não | Rerank LLM |
| `debug` | Não | Metadados de debug |

Query params: `?debug=1`, `?rerank=1`.

**Resposta** inclui `search_id`, `results[]`, `latency_ms`, `query`, `mode`, embeddings meta.

Validação Zod compartilhada com a tool MCP `search_text` (`src/schemas/searchText.js`).

## Exemplo

```bash
curl -X POST http://localhost:3000/search/text \
  -H "Content-Type: application/json" \
  -d '{
    "query": "energia solar",
    "weights": {
      "produto": 0.35,
      "servico": 0.25,
      "descricao": 0.2,
      "publico": 0.1,
      "cliente": 0.1
    },
    "filter": { "uf": "SP" },
    "final_limit": 10
  }'
```

Com auth:

```bash
curl -X POST http://localhost:3000/search/text \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"query":"consultoria SAP","final_limit":5}'
```
