# BuscaFornecedor API + MCP

Base inicial da API de busca de fornecedores (Qdrant + OpenAI), com o mesmo núcleo de `qdrant_busca`, restrito ao essencial:

| Incluído | Depois |
|----------|--------|
| `POST /search/text` (texto + pesos + filtros + BM25) | Auth Supabase JWT |
| `GET /config`, `GET /health` | Cotas / telemetria |
| `POST/GET/DELETE /mcp` (tools `search_text`, `get_config`) | Busca regional (cidades) |
| `GET /search/xray` — chat conversacional (pré-proxy Microsoft) | Hub Copilot produção |

Todo endpoint de negócio deve ter **tool MCP correspondente** (mesmo serviço compartilhado).

**Critérios de aceite (DoD):** [`docs/aceitacao.md`](docs/aceitacao.md)  
**Auth + Supabase (plano):** [`docs/plano-supabase-auth.md`](docs/plano-supabase-auth.md)

## Quick start

```bash
cp .env.example .env   # Qdrant + OpenAI
npm install
npm start
```

- Health: `GET /health`
- Config: `GET /config`
- Busca: `POST /search/text`
- MCP: `http://HOST:PORT/mcp`

```bash
# exemplo mínimo
curl -X POST http://localhost:3000/search/text \
  -H "Content-Type: application/json" \
  -d '{"query":"energia solar","final_limit":10}'

# com pesos por dimensão (soma = 1.0)
curl -X POST http://localhost:3000/search/text \
  -H "Content-Type: application/json" \
  -d '{
    "query": "energia solar",
    "weights": {
      "produto": 0.35,
      "servico": 0.25,
      "descricao": 0.2,
      "publico": 0.1,
      "cliente": 0.1
    },
    "final_limit": 10
  }'
```

```bash
npm run test:mcp -- "energia solar"
```

## Estrutura

```
src/
  server.js / app.js        # Boot + factory Express
  config/env.js             # Validação de boot, defaults, AUTH_MODE
  schemas/searchText.js     # Zod compartilhado REST + MCP
  middleware/               # auth, requestId, errorHandler
  errors/AppError.js
  routes/index.js           # /config, /search/text
  searchService.js          # núcleo de busca
  multiVectorSearch.js
  embeddings.js / llmRerank.js / qdrantClient.js
  mcp/                      # Streamable HTTP MCP
  xray/                     # Pré-proxy agente Microsoft (UI + agent)
docs/                       # arquitetura, API, MCP, suporte
adr/
.cursor/                    # rules, skills
AGENTS.md
```

## Cursor AI Stack

Conhecimento persistente para o agente (não depende só do chat):

| Camada | Onde | Uso |
|--------|------|-----|
| Rules | `.cursor/rules/` | Como programar neste repo |
| Skills | `.cursor/skills/` | Especialistas + `/new-endpoint`, `/new-mcp-tool`, `/new-worker`, `/add-auth` |
| Docs | `docs/` | Contratos e arquitetura — comece em [`docs/INDEX.md`](docs/INDEX.md) |
| ADRs | `adr/` | Decisões (hot path sync, parity MCP, auth, …) |
| MCPs | `docs/mcp-servers.md` | Servidores externos (GitHub, Postgres, …) |

Roadmap deste repo: [`docs/PLANO_ESCALAVEL.md`](docs/PLANO_ESCALAVEL.md). Visão longa (não = código atual): [`docs/GUIA_IMPLEMENTACAO.md`](docs/GUIA_IMPLEMENTACAO.md).

## Body de `POST /search/text`

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `query` | Sim | Texto principal a embedar |
| `queries` | Não | Texto por dimensão (`{ produto: "...", ... }`) |
| `weights` | Não | Pesos por dimensão (+ `bm25`). Soma = 1.0; default = iguais |
| `filter` / `filter_not` | Não | Filtros keyword / full-text |
| `bm25_query` / `bm25` | Não | Híbrido BM25 |
| `limit_per_vector` / `final_limit` | Não | Limites de candidatos / resultado |
| `rerank` | Não | Rerank LLM opcional |

Use `GET /config` para ver as chaves de dimensões e filtros configuradas.

## Deploy no Railway

1. Conecte o repositório GitHub no [Railway](https://railway.app) (New Project → Deploy from GitHub).
2. Em **Variables**, configure pelo menos:

| Variável | Obrigatória | Notas |
|----------|-------------|-------|
| `QDRANT_KEY` | Sim | API key do cluster |
| `CLUSTER_ENDPOINT` | Sim | URL HTTPS do Qdrant |
| `COLLECTION_NAME` | Sim | Coleção de busca |
| `OPENAI_API_KEY` | Sim | Embeddings / rerank |
| `QDRANT_DIMENSION_KEYS` | Sim* | Ex.: `produto,servico,...` |
| `QDRANT_VECTOR_NAMES` | Sim* | Ex.: `v_produto,v_servico,...` |
| `NODE_ENV` | Recomendado | `production` |
| `HOST` | Opcional | Default `0.0.0.0` |

\* Use os mesmos valores do `.env.example`. Demais vars (BM25, filtros, embed dims) conforme o cluster.

3. **Não** defina `PORT` manualmente — o Railway injeta automaticamente.
4. Publique um domínio em **Settings → Networking → Generate Domain**.
5. Healthcheck: `GET /health` (já configurado em `railway.toml`).

```bash
curl https://SEU-DOMINIO.up.railway.app/health
curl -X POST https://SEU-DOMINIO.up.railway.app/search/text \
  -H "Content-Type: application/json" \
  -d '{"query":"energia solar","final_limit":5}'
```

MCP remoto: `https://SEU-DOMINIO.up.railway.app/mcp`

## Extensão

No Agent, use `/new-endpoint`, `/new-mcp-tool`, `/add-auth` ou `/new-worker` — ou manualmente:

1. **Novo endpoint REST** → `src/routes/index.js` (atrás de `authMiddleware`) + service compartilhado.
2. **Tool MCP** → `src/mcp/createMcpServer.js` chamando a mesma função de serviço.
3. **Auth** → `src/middleware/auth.js` + mesmo contrato no mount MCP.

Roadmap: [`docs/PLANO_ESCALAVEL.md`](docs/PLANO_ESCALAVEL.md) · Agente: [`AGENTS.md`](AGENTS.md).
