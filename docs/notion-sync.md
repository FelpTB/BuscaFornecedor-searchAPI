# Sincronizar documentação com Notion

## Status

MCP Notion configurado localmente via `@notionhq/notion-mcp-server` + `NOTION_TOKEN` em:

- `~/.cursor/mcp.json` (global Cursor)
- `.cursor/mcp.json` do projeto (**gitignored** — não vai para o GitHub)

Template sem secret: `.cursor/mcp.json.example`.

## Passos obrigatórios no Notion

1. Abra [integrações](https://www.notion.so/profile/integrations) e confirme a integração da chave.
2. Em cada página/database que o agente deve ver: **⋯ → Conectar à integração** (ou Access na integração).
3. **Developer: Reload Window** no Cursor (ou toggle MCP Notion off/on em Settings → MCP).

## Usar no chat

Exemplos:

- “Crie uma página Notion ‘BuscaFornecedor Docs’ com o conteúdo de docs/implementacao-supabase.md”
- “Liste páginas acessíveis à integração”
- “Atualize a página X com o checklist de docs/aceitacao.md”

## Segurança

- Nunca commitar `NOTION_TOKEN` / `.cursor/mcp.json` com secret.
- Se a chave foi colada em chat, **rotacione** em Notion → Integration → Secrets e atualize o `mcp.json` local.
