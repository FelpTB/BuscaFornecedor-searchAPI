# MCPs externos recomendados (Cursor)

Estes servidores aumentam a memória operacional do agente (banco, filas, deploy, git). Configure em `.cursor/mcp.json` (template no repo) ou via UI Cursor → Settings → MCP.

| MCP | Uso no BuscaFornecedor | Quando habilitar |
|-----|------------------------|------------------|
| **Notion** | Docs do projeto no workspace Notion | Já (token local em `.cursor/mcp.json`, gitignored) |
| **GitHub** | PRs, issues, checks | Já no dia a dia |
| **PostgreSQL / Supabase** | Schema, SELECT, índices | Após Fase 1 (DB) |
| **Redis** (se disponível) | Filas/cotas | Após Fase 2 |
| **Qdrant** (se disponível) | Coleções, payload, busca | Útil já agora |
| **Railway** | Logs, vars, restart | Deploy contínuo |
| **Docker** | Compose/containers | Se adicionar Docker local |
| **Context7 / docs** | Docs de libs | Opcional |

## Notion (local)

Config oficial (`@notionhq/notion-mcp-server`) com `NOTION_TOKEN`:

1. Arquivo **local** (não commitado): `.cursor/mcp.json` e/ou `~/.cursor/mcp.json`
2. Template sem secret: `.cursor/mcp.json.example`
3. No Notion: compartilhe páginas/databases com a integração (**⋯ → Conectar à integração**)
4. Recarregue o Cursor (MCP) e teste: “liste páginas no Notion”

Detalhes: [`notion-sync.md`](notion-sync.md).

## Princípios

1. Poucos MCPs — só o que o time usa de verdade.
2. Credenciais só em env do Cursor / secrets locais — nunca commitadas.
3. MCP **deste produto** (`/mcp` da API) é o servidor de busca; os acima são para o **agente de desenvolvimento**.

## Plugins Cursor sugeridos

GitHub · Docker (se houver) · PostgreSQL (fase DB) · Railway. Evitar excesso de extensões sem uso.
