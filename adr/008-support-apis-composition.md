# ADR 008 — Composição das APIs de suporte

## Status

Aceito (inventário)

## Contexto

Existem quatro serviços Railway/GitHub relacionados ao BuscaFornecedor. É preciso definir o papel de cada um na API+MCP unificada.

## Decisão

| Serviço | Papel na arquitetura-alvo |
|---------|---------------------------|
| **API-busca-cidades** | Dependência HTTP para expansão geográfica (regional) |
| **Qdrant_Request_API** | Fonte de ingestão/indexação e referência do algoritmo full; ops de Qdrant |
| **BuscaFornecedor-searchAPI** / **este repo** | Superfície pública de busca REST+MCP (hot path) |
| **BuscaFornecedor_MCP** | Apenas documentação/apresentação — **não** runtime |

Fluxo regional alvo:

```
cities/nearby → filter cidade → search/text (regional) → se insuficiente → search nacional
```

## Consequências

- Não reimplementar Haversine/IBGE neste repo; consumir a API de cidades.
- Não misturar pipeline de indexação no hot path da search API (manter separação searchAPI vs Qdrant_Request).
- Validar `vector_names` e BM25 nos deploys live antes de calibração de pesos.
- Documentação: `docs/support-apis.md` e filhos.
