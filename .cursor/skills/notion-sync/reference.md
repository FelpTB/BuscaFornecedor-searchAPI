# Notion — mapa canônico (ABC Advise)

Workspace: **ABC Advise**. MCP: `user-notion`.

## Data sources

| Nome | data_source_id | database_id (parent) | URL |
|------|----------------|----------------------|-----|
| Busca_Fornecedor Roadmap | `239dca3e-b7d8-8033-9f13-000b4f05655a` | `239dca3e-b7d8-8023-aa32-f46f50c9dd97` | https://app.notion.com/p/239dca3eb7d88023aa32f46f50c9dd97 |
| Document Hub | `239dca3e-b7d8-809f-b225-000b3c30e053` | `239dca3e-b7d8-8002-aae1-f8d06f73467d` | https://app.notion.com/p/239dca3eb7d88002aae1f8d06f73467d |

## Roadmap — propriedades

| Property | Type | Valores relevantes |
|----------|------|--------------------|
| Project name | title | `(Fase N) …` |
| Status | status | `Backlog`, `Planned`, `In progress`, `Completed`, `Cancelled`, `On Hold` |
| Tempo de Desenvolvimento | multi_select | `1 Dia`, `2 Dias`, `3 Dias`, `2 a 5 Dias`, `7 Dias`, `10 Dias`, `2 Meses` |
| Priority | select | `High`, `Medium`, `Low` |
| Effort | select | `XS`, `S`, `M`, `L`, `red` |
| Team | multi_select | `AI`, `Platform`, `Security`, `Mobile` |
| Category | multi_select | `New Feature`, `Enhancement`, `Bug Fix`, `Performance Improvement`, `UI/UX` |
| Owner | people | — |
| Date | date | — |

### Patch Status (exemplo)

```json
{
  "page_id": "3acdca3e-b7d8-802e-b210-f72579ae510f",
  "properties": {
    "Status": { "status": { "name": "In progress" } }
  }
}
```

## Roadmap — páginas (Fases)

| Fase | page_id | Status (snapshot) |
|------|---------|-------------------|
| (Fase 0) Registrar parceira Microsoft | `3acdca3e-b7d8-80c4-93a7-f5b59dc4206a` | In progress |
| (Fase 1) Migrar n8n → API em código | `3acdca3e-b7d8-802e-b210-f72579ae510f` | In progress ← **foco deste repo** |
| (Fase 2) VSCode + M365 Agents Toolkit | `3acdca3e-b7d8-80e2-9d03-dc7f8400b2b3` | Planned |
| (Fase 3) Agent Proxy + identidade | `3acdca3e-b7d8-80ce-a59b-e2a7e871440b` | Planned |
| (Fase 4) Infra nuvem + empacotamento | `3acdca3e-b7d8-80f5-9061-c7106d93ddb7` | Planned |
| (Fase 5) Homologação sideload | `3acdca3e-b7d8-8042-bf13-f61ed5ddf0b4` | Planned |
| (Fase 6) Vitrine AppSource | `3acdca3e-b7d8-80bc-a77a-eef32eb72258` | Planned |
| (Fase 7) Certificação Microsoft | `3acdca3e-b7d8-8045-ab91-c7cfb6d10d10` | Planned |
| (Fase Extra) Pagamento Microsoft | `3acdca3e-b7d8-80f7-9b99-e2c8b4cdbde7` | Planned |

## Document Hub — propriedades

| Property | Type | Valores |
|----------|------|---------|
| Doc name | title | — |
| Category | multi_select | `Proposal`, `Customer research`, `Strategy doc`, `Planning`, `Technical Documentation` |
| Projeto | multi_select | `Busca Fornecedor` |
| Last updated time / Created time / … | read-only | — |

### Criar página no Hub (parent)

```json
{
  "parent": { "type": "database_id", "database_id": "239dca3e-b7d8-8002-aae1-f8d06f73467d" },
  "properties": {
    "Doc name": { "title": [{ "text": { "content": "Título" } }] },
    "Category": { "multi_select": [{ "name": "Technical Documentation" }] },
    "Projeto": { "multi_select": [{ "name": "Busca Fornecedor" }] }
  }
}
```

(Usar `API-post-page`; confirmar schema no MCP antes.)

## Document Hub — docs técnicos Busca Fornecedor

| Doc name | page_id | Repo espelho (se houver) |
|----------|---------|--------------------------|
| Documentação Técnica Supabase | `341dca3e-b7d8-80a2-baac-dac75e4168d0` | `docs/plano-supabase-auth.md`, `docs/implementacao-supabase.md` |
| Documentação Técnica Qdrant | `341dca3e-b7d8-809f-a655-eff481e08b65` | `docs/` + ADR search |
| Documentação Técnica Railway | `341dca3e-b7d8-80a5-957d-f116e33f88c1` | skill `railway-deploy` |
| Documentação Técnica N8N | `341dca3e-b7d8-80f2-8cb3-de5b35160971` | legado (Fase 1 migra embora) |
| Documentação Técnica Stripe | `341dca3e-b7d8-807f-8bcd-c20fc8e66eaf` | — |
| Documentação Técnica PostgreSQL Local | `341dca3e-b7d8-8054-be02-c11dd0aaf080` | — |
| Documentação Técnica Front-end Lovable | `341dca3e-b7d8-8052-a995-ccff5027e353` | — |
| Rascunho Roadmap App Microsoft | `3acdca3e-b7d8-8090-965f-f01cef45b7a5` | Strategy |
| Docs testes Julho | `3a7dca3e-b7d8-8062-8af9-ff783bd16c4e` | — |
| Mods plataforma Julho | `3a6dca3e-b7d8-80d7-bcf4-fa93c0c4b94a` | — |

## Template — progresso na página da fase

Append via `API-update-page-markdown` com `type: insert_content` + `position: { type: "end" }` **ou** `update_content` se já existir âncora:

```markdown
## Progresso YYYY-MM-DD (API+MCP)

- O quê: …
- Repo: commits / PRs …
- Docs locais: `docs/…`
- Status DoD: critérios X/Y em `docs/aceitacao.md`
- Próximo: …
```

## MCP tools (ordem típica)

1. `API-query-data-source` — listar/filtrar
2. `API-retrieve-page-markdown` — ler conteúdo
3. `API-patch-page` — Status / Priority / Category
4. `API-update-page-markdown` — corpo
5. `API-post-page` — novo item Hub/Roadmap
6. `API-search` — achar por título se ID desconhecido

## Relação repo ↔ Notion

| Área código | Notion |
|-------------|--------|
| API search, MCP, X-Ray, cities | Fase 1 + docs API (criar se faltar) |
| Auth híbrida, api_keys, consultas, aparicoes | Fase 1 + Hub Supabase |
| Railway env/deploy | Hub Railway + Fase 4 |
| Entra / Agent Proxy | Fase 3 |
| n8n legado | Hub N8N (marcar legado) |
