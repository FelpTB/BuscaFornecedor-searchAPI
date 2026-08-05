# Sincronizar documentação com Notion

O Cursor deste workspace **não tem** servidor MCP Notion conectado (`GetMcpTools` não lista Notion).

## Opção A — MCP Notion (recomendado)

1. Crie uma integração em [Notion Developers](https://www.notion.so/my-integrations) e copie o token.
2. Compartilhe as páginas/databases desejadas com a integração.
3. No Cursor: **Settings → MCP → Add new MCP server** (ou edite `mcp.json`):

```json
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server"],
      "env": {
        "OPENAPI_MCP_HEADERS": "{\"Authorization\":\"Bearer ntn_***\",\"Notion-Version\":\"2022-06-28\"}"
      }
    }
  }
}
```

(Consulte o pacote/MCP Notion atual — o formato de env pode variar.)

4. Reinicie o Cursor e peça ao agente: “publique/atualize a página Notion X com docs/implementacao-supabase.md”.

## Opção B — Manual / CSV

Copie para um database Notion as páginas:

| Doc local | Uso |
|-----------|-----|
| `docs/aceitacao.md` | DoD |
| `docs/plano-supabase-auth.md` | Plano |
| `docs/implementacao-supabase.md` | O que foi feito |
| `docs/supabase-users.md` | Schema live |
| `adr/010-supabase-hybrid-auth-telemetry.md` | Decisão |

## Opção C — GitHub ↔ Notion

Use automação (Zapier/Make) ou o Notion GitHub sync para espelhar `docs/**` do repositório `FelpTB/BuscaFornecedor-searchAPI`.
