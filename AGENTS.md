# AGENTS.md — memória persistente do projeto

Leia isto no início de tarefas não triviais.

## O que é este projeto

API + MCP de busca híbrida de fornecedores (Qdrant + OpenAI + Supabase), Node.js ESM / Express, deploy Railway.

## Onde está o conhecimento

| Camada | Path / lugar | Função |
|--------|----------------|--------|
| Código | `src/` | **Verdade operacional** |
| Rules | `.cursor/rules/*.mdc` | Como programar |
| Skills | `.cursor/skills/*/SKILL.md` | Workflows `/…` |
| SQL | `sql/migrations/` | Schema produto |
| Notion Roadmap | Fase 1… | Planejamento produto / DoD |
| Notion Document Hub | *SearchAPI + MCP (Railway)* etc. | Documentação técnica (única fonte) |

**Não** recriar pasta `docs/` longa no repo. Atualizar o Document Hub via skill `notion-sync`.

## Regras de ouro

1. Lógica de busca só em `searchService` (ou domínio em `src/search/`).
2. REST e MCP compartilham o mesmo service.
3. Código em `src/` = verdade. Visões futuras (BullMQ, Entra) = Notion / ADRs históricos no Hub — **não** assumir implementado.
4. Envio claim/SMS/e-mail = n8n + notificacao-clientes; API só `recebe-consulta`.
5. Após entregas significativas: skill `notion-sync` (Roadmap + Document Hub).

## Commands (skills)

| Comando | Efeito |
|---------|--------|
| `/new-endpoint` | Rota + service + tool MCP |
| `/new-mcp-tool` | Tool Zod + parity |
| `/add-auth` | Auth híbrida |
| `/new-worker` | Worker futuro (só se pedido) |

## Skills de domínio

`express-api`, `mcp-tools`, `qdrant-search`, `openai-embeddings`, `security-hardening`, `railway-deploy`, `supabase-db`, `notion-sync`
