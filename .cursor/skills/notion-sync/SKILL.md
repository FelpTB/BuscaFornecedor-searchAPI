---
name: notion-sync
description: >-
  Syncs BuscaFornecedor progress with Notion Roadmap and Document Hub (ABC Advise
  workspace). Use after completing features, merging milestones, changing DoD
  criteria, updating docs/, or when the user mentions Notion, roadmap, Document
  Hub, documentation sync, or project status.
---

# Notion Sync — Roadmap + Document Hub

## Quando aplicar (sempre que)

- Entregar feature / fechar critério de aceite / mudar auth, busca, X-Ray, Supabase
- Atualizar `docs/` ou ADRs relevantes
- Usuário pedir status, roadmap ou documentação Notion
- Início de sessão longa: ler Roadmap + Hub antes de planejar

**Fonte da verdade do código:** `src/` + `docs/` do repo.  
**Fonte da verdade do planejamento de produto:** Notion Roadmap + Document Hub.

## IDs canônicos (workspace ABC Advise)

Ver detalhes em [reference.md](reference.md).

| Recurso | data_source_id |
|---------|----------------|
| **Busca_Fornecedor Roadmap** | `239dca3e-b7d8-8033-9f13-000b4f05655a` |
| **Document Hub** | `239dca3e-b7d8-809f-b225-000b3c30e053` |

MCP: servidor `user-notion` (`API-query-data-source`, `API-patch-page`, `API-update-page-markdown`, `API-post-page`, `API-retrieve-page-markdown`).

## Checklist pós-entrega

```
- [ ] Query Roadmap: localizar item (ex. Fase 1) e atualizar Status se mudou
- [ ] Append markdown na página da fase com o que foi feito (data + bullets + links repo)
- [ ] Document Hub: criar/atualizar doc técnico se mudou arquitetura/API/Supabase/Railway
- [ ] Category = Technical Documentation; Projeto = Busca Fornecedor
- [ ] Atualizar docs/aceitacao.md no repo se critério DoD mudou
- [ ] Não expor secrets (tokens, service role, API keys) no Notion
```

## Roadmap — regras

**Status:** `Backlog` | `Planned` | `In progress` | `Completed` | `Cancelled` | `On Hold`

Mapeamento típico deste repo:

| Item Notion | Relação com o código |
|-------------|----------------------|
| (Fase 1) Migrar n8n → API em código | Hot path API+MCP+X-Ray+Supabase auth/telemetria |
| (Fase 3) Agent Proxy + identidade | Entra/Microsoft + auth híbrida (ADR 010) |
| (Fase 4) Infra nuvem | Railway / env / workers |

Ao avançar desenvolvimento:

1. `API-query-data-source` no Roadmap
2. `API-patch-page` → `Status` (ex. manter `In progress` ou `Completed` se fase fechada)
3. `API-update-page-markdown` → append seção `## Progresso YYYY-MM-DD` (não apagar conteúdo humano sem pedido)

## Document Hub — regras

Propriedades:

- **Doc name** (title)
- **Category:** preferir `Technical Documentation` (também Strategy doc, Planning, …)
- **Projeto:** `Busca Fornecedor`

Docs técnicos existentes a manter alinhados:

- Documentação Técnica Supabase
- Documentação Técnica Qdrant
- Documentação Técnica Railway
- Documentação Técnica N8N (histórico — marcar como legado quando API substituir)

Fluxo:

1. Ler página com `API-retrieve-page-markdown`
2. Comparar com `docs/` do repo (`implementacao-supabase.md`, `aceitacao.md`, `api.md`, …)
3. Atualizar com `API-update-page-markdown` **ou** criar página nova no Hub se não existir equivalente

## Nunca

- Commitar `NOTION_TOKEN`
- Sobrescrever páginas inteiras sem necessidade (`replace_content` só com confirmação)
- Inventar status de fase sem evidência no código
- Duplicar docs sem checar Hub primeiro

## Commands úteis

- `/notion-sync` implícito via esta skill
- Após milestone: “atualize o Notion” → seguir checklist acima
