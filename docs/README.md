# Documentacao

A documentacao de produto e tecnica deste servico vive no **Notion Document Hub** (workspace ABC Advise).

Nao mantenha espelhos longos neste repositorio — a fonte da verdade e o Hub.

Procure a pagina:

**Documentacao Tecnica SearchAPI + MCP (Railway)**

Tambem relacionadas: Documentacao Tecnica Supabase, Qdrant, Railway, N8N (legado).

## Referência da API (REST + MCP)

| Arquivo | Conteudo |
|---------|----------|
| [api/GUIA.md](./api/GUIA.md) | **Comece aqui** - conceitos, primeiros passos, pré-configurações de pesos e foco, boas práticas |
| [api/REFERENCE.md](./api/REFERENCE.md) | Visão geral: auth, erros, rate limits, Agent-Proxy |
| [api/ENDPOINTS.md](./api/ENDPOINTS.md) | **Catálogo completo** — cada endpoint com funcionamento, input e output |

Os mesmos arquivos são servidos como páginas navegáveis em `GET /docs` (guia, endpoints, referência) e como markdown em `GET /docs/{slug}.md`.

## Agent-Proxy (Microsoft / Teams)

Especificacoes operacionais para o Custom Engine Agent (VS Code + M365 Agents Toolkit). Espelho no repo; Hub Notion e a fonte documental apos sync.

| Arquivo | Conteudo |
|---------|----------|
| [agent-proxy/REQUISITOS_AGENT_PROXY.md](./agent-proxy/REQUISITOS_AGENT_PROXY.md) | Requisitos de certificação / hospedagem Azure |
| [agent-proxy/INTEGRACAO_BACKEND_API.md](./agent-proxy/INTEGRACAO_BACKEND_API.md) | Mapeamento desta API ↔ Agent-Proxy |

Para o agente Cursor: ver AGENTS.md e skill notion-sync.
