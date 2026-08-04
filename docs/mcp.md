# MCP (Model Context Protocol) — v1

## Transport

- Path: `/mcp`
- Protocolo: **Streamable HTTP**
- Auth: mesma política REST (`AUTH_MODE` via `resolveAuthContext`)
- Sessões: in-memory (1 instância Railway)

## Tools

| Tool | Espelha | Schema |
|------|---------|--------|
| `get_config` | `GET /config` | — |
| `search_text` | `POST /search/text` | `src/schemas/searchText.js` (inclui `debug`) |

Ambas chamam `executeSearchByText` / `getPublicConfig` — zero lógica duplicada.

## Smoke

```bash
npm run test:mcp -- "energia solar"
```

Com auth:

```bash
# headers no cliente MCP: Authorization: Bearer <key>
```
