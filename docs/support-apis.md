# APIs de suporte — inventário e contratos

Documentação das APIs externas que alimentam a implementação completa do BuscaFornecedor API+MCP.

Clones locais de análise (não versionados): `_vendor_apis/` (gitignored).

| # | Serviço | Live | GitHub | Papel |
|---|---------|------|--------|-------|
| 1 | **API busca-cidades** | [railway](https://api-busca-cidades-buscafornecedor.up.railway.app/) | [FelpTB/API-busca-cidades](https://github.com/FelpTB/API-busca-cidades) | Expansão geográfica (cidade → vizinhas) |
| 2 | **Qdrant Request API** | [railway](https://qdrantrequestapi-buscafornecedor.up.railway.app/) | [FelpTB/Qdrant_Request_API](https://github.com/FelpTB/Qdrant_Request_API) | Plataforma completa: indexação + busca híbrida + MCP |
| 3 | **BuscaFornecedor MCP** | [railway](https://buscafornecedormcp-buscafornecedor.up.railway.app/) | [FelpTB/BuscaFornecedor_MCP](https://github.com/FelpTB/BuscaFornecedor_MCP) | Site/apresentação do hub — **não é MCP runtime** |
| 4 | **BuscaFornecedor searchAPI** | [railway](https://buscafornecedor-searchapi-buscafornecedor.up.railway.app/) | [FelpTB/BuscaFornecedor-searchAPI](https://github.com/FelpTB/BuscaFornecedor-searchAPI) | Fatia search-only + MCP (base deste workspace) |
| 5 | **Notificacao clientes** | [railway](https://notificacao-clientes-buscafornecedor.up.railway.app/) | [maicon-abc-advise/notificacao-clientes](https://github.com/maicon-abc-advise/notificacao-clientes) | Fila email/SMS + dashboard; recebe-consulta pos-busca |

Detalhes por serviço:

- [support-api-busca-cidades.md](support-api-busca-cidades.md)
- [support-api-qdrant-request.md](support-api-qdrant-request.md)
- [support-api-mcp-site.md](support-api-mcp-site.md)
- [support-api-searchapi.md](support-api-searchapi.md)
- [comms.md](comms.md) - integracao notificacao-clientes

## Mapa de composição (API completa)

```
                    ┌─────────────────────────────┐
                    │  BuscaFornecedor API+MCP    │
                    │  (este repo / orquestrador) │
                    └──────────────┬──────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
  API-busca-cidades      searchAPI / Qdrant_Request    (futuro)
  resolver cidade        busca híbrida Qdrant         CRM / notify
  + raio (regional)      dual-path-rrf-v5 + MCP
                                   │
                                   ▼
                              Qdrant Cloud
                         (+ Postgres no pipeline
                            da Qdrant_Request_API)
```

### Papéis na implementação futura

| Capacidade (GUIA / produto) | Fonte de verdade hoje |
|-----------------------------|------------------------|
| Resolver cidade / raio regional | **API-busca-cidades** |
| Busca híbrida (hot path) | **searchAPI** (= este workspace) **ou** subset da **Qdrant_Request_API** |
| Indexação Postgres → Qdrant | **Qdrant_Request_API** (`/pipeline/*`) |
| MCP tools de busca | searchAPI ou Qdrant_Request (`get_config`, `search_text`) |
| Visão MCP Search Hub / slides | **BuscaFornecedor_MCP** (docs/marketing only) |

## Relação entre os repositórios Node

```
Qdrant_Request_API          ← full (search + ingest + admin + X-Ray)
        │ extract / slim
        ▼
BuscaFornecedor-searchAPI   ← search-only REST+MCP
        │ same DNA
        ▼
BuscaFornecedor-Api-Mcp-Main (este workspace)  ← evolução + AI stack docs
```

**BuscaFornecedor_MCP** não está nessa linhagem de código — é apresentação que *referencia* as outras APIs (`repositorios.txt`).

## Alertas de integração (live 2026-08-04)

1. **Qdrant_Request `/config`**: `vector_names` parece trocado (`publico→v_cliente`, `cliente→v_publico`). Validar antes de depender de pesos por dimensão nessa instância.
2. **searchAPI live**: `bm25.vector_name: null` — BM25 desligado nesse deploy; Qdrant_Request tem `bm25_complete_profile` ativo.
3. **Auth**: nenhuma das APIs de suporte autentica clientes ainda.
4. **Raiz `/`**: searchAPI e Qdrant_Request retornam 404 na raiz; use `/health` e `/config`.

## Próximos passos sugeridos

1. Orquestrar regional: cities nearby → `filter.cidade` / lista de nomes no `search/text`.
2. Manter indexação na Qdrant_Request (ou extrair worker) e busca neste repo.
3. Não tratar o site MCP como runtime — implementar tools no `src/mcp` deste projeto.
