# Support — BuscaFornecedor_MCP (site)

| | |
|--|--|
| **Live** | https://buscafornecedormcp-buscafornecedor.up.railway.app/ |
| **GitHub** | https://github.com/FelpTB/BuscaFornecedor_MCP |
| **Stack** | Node · Express (CommonJS) · HTML/Reveal.js estático |
| **Auth** | Nenhuma |

## Propósito real

**Apresentação / portfolio** do “MCP Search Hub” e do pipeline de dados (scrape → chunk → LLM → Qdrant).  
**Não implementa** Model Context Protocol, Qdrant nem busca.

Live `/` = deck técnico HTML. `/health` **não existe** (404); health Railway: `/saude` → `"ok"`.

## Rotas

| Método | Path | Conteúdo |
|--------|------|----------|
| GET | `/` | `index.html` (Reveal.js) |
| GET | `/comercial` | Apresentação comercial |
| GET | `/portfolio` | Portfolio |
| GET | `/saude` | Health string |

## Docs úteis no repo (visão de produto)

| Arquivo | Conteúdo |
|---------|----------|
| `plano-implementacao.md` | Roadmap hub MCP (n8n + Copilot/Claude) |
| `resumo_mcp.txt` | Brief: encapsular APIs HTTP em tools MCP |
| `repositorios.txt` | Links: Qdrant_Request_API, API-busca-cidades, notificacao-clientes |

## Implicação

Para a API completa, este repo é **referência de narrativa e roadmap**, não dependência de runtime.  
MCP de busca = `src/mcp` deste workspace / searchAPI / Qdrant_Request.
