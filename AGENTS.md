# AGENTS.md — memória persistente do projeto

Este repositório está preparado para o Cursor Agent. Leia isto no início de tarefas não triviais.

## O que é este projeto

API + MCP de busca híbrida de fornecedores (Qdrant + OpenAI), Node.js ESM / Express, deploy Railway.

## Onde está o conhecimento

| Camada | Path | Função |
|--------|------|--------|
| Rules | `.cursor/rules/*.mdc` | Como programar (sempre / por glob) |
| Skills | `.cursor/skills/*/SKILL.md` | Especialistas + workflows `/…` |
| Docs | `docs/` | Arquitetura e contratos |
| ADRs | `adr/` | Decisões (aceitas e propostas) |
| MCP dev | `docs/mcp-servers.md` | MCPs externos recomendados |

Índice docs: [`docs/INDEX.md`](docs/INDEX.md).

## Regras de ouro

1. Lógica de busca só em `searchService` (ou serviços de domínio).
2. REST e MCP compartilham o mesmo service.
3. Código em `src/` = verdade. `PLANO_ESCALAVEL.md` = evolução. `GUIA_IMPLEMENTACAO.md` = visão longa — **não** assumir FastAPI/RabbitMQ implementados.
4. APIs de suporte: inventário em `docs/support-apis.md` (cidades, Qdrant Request, searchAPI, site MCP).
5. Consultar ADRs antes de mudar arquitetura.

## Commands (skills com invoke explícito)

| Comando | Efeito |
|---------|--------|
| `/new-endpoint` | Rota + service + tool MCP + docs |
| `/new-mcp-tool` | Tool Zod + parity |
| `/new-worker` | Worker BullMQ telemetria (PLANO) |
| `/add-auth` | Fase 1 API key |

## Skills de domínio (auto)

`express-api`, `mcp-tools`, `qdrant-search`, `openai-embeddings`, `security-hardening`, `railway-deploy`
