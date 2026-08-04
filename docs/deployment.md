# Deploy (Railway)

- Build: Nixpacks (`railway.toml`)
- Start: `npm start` → `node src/server.js`
- Healthcheck: `GET /health`
- `PORT` injetado pelo Railway — **não** fixar manualmente
- `HOST` default `0.0.0.0`

## Variáveis mínimas

`QDRANT_KEY`, `CLUSTER_ENDPOINT`, `COLLECTION_NAME`, `OPENAI_API_KEY`, `QDRANT_DIMENSION_KEYS`, `QDRANT_VECTOR_NAMES`, `NODE_ENV=production`.

Detalhes: README + `.env.example`.

## Multi-serviço (roadmap)

| Serviço | Comando | Uso |
|---------|---------|-----|
| `api` | `npm start` | REST + MCP |
| `worker` | `node worker/index.js` | Telemetria → Supabase |

Ver `PLANO_ESCALAVEL.md` §6.
