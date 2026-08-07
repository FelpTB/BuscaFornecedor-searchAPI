---
name: notion-sync
description: >-
  Syncs BuscaFornecedor progress with Notion Roadmap and Document Hub (ABC Advise
  workspace). Use after completing features, merging milestones, changing DoD
  criteria, or when the user mentions Notion, roadmap, Document Hub, or project status.
---

# Notion Sync — Roadmap + Document Hub

## Quando aplicar

- Entregar feature / fechar critério de aceite / mudar auth, busca, X-Ray, Supabase
- Usuário pedir status, roadmap ou documentação Notion
- Início de sessão longa: ler Roadmap + Hub antes de planejar

**Fonte da verdade do código:** `src/` + `sql/`.  
**Fonte documental / planejamento:** Notion Roadmap + Document Hub (não espelhar em `docs/` longos).

## IDs canônicos

Ver [reference.md](reference.md).

| Recurso | data_source_id |
|---------|----------------|
| **Busca_Fornecedor Roadmap** | `239dca3e-b7d8-8033-9f13-000b4f05655a` |
| **Document Hub** | `239dca3e-b7d8-809f-b225-000b3c30e053` |

Doc canônico desta API: **Documentação Técnica SearchAPI + MCP (Railway)** — `3b5dca3e-b7d8-814a-9092-fe7122b7fb53`

## Checklist pós-entrega

```
- [ ] Query Roadmap: atualizar Status se mudou
- [ ] Append progresso na página da fase
- [ ] Atualizar Hub SearchAPI + MCP (e Supabase/Railway se couber)
- [ ] Category = Technical Documentation; Projeto = Busca Fornecedor
- [ ] Não colar secrets
```

## Nunca

- Commitar `NOTION_TOKEN`
- Inventar status de fase sem evidência no código
- Recriar pasta `docs/` longa no GitHub
