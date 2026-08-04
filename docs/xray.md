# X-Ray — chat conversacional (pré-proxy Microsoft)

UI embutida: [`/search/xray`](../src/xray/).

## Papel

Aba de **conversa multi-turn**: o usuário guia o agente em linguagem natural. O agente pode clarificar, refinar filtros e só então buscar fornecedores.

Pipeline quando busca:

1. Classifica intent: `PRODUTO` | `SERVICO` | `MISTO` (Query Manager)
2. Pesos fixos (servidor)
3. BM25 discriminante + `Modelo_Negocio`
4. Geo opcional → API-busca-cidades → `filter.cidade = [lista]`
5. Executa `search_text` (mesmo núcleo REST/MCP)
6. Responde em NL resumindo resultados

## Tools do chat

| Tool | Função |
|------|--------|
| `search_suppliers` | Briefing NL → QM + cities + `search_text` |
| `lookup_cities` | Confirma cobertura do raio |
| `get_search_config` | Espelho de `/config` |

Sessões em memória (`src/xray/chatSessions.js`), TTL ~60 min. `session_id` fica no `localStorage` da UI.

## Endpoints

| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/search/xray` | UI HTML (chat) |
| POST | `/search/xray/chat` | Turno conversacional |
| POST | `/search/xray/chat/reset` | Nova sessão |
| POST | `/search/xray/run` | One-shot legado (compat) |
| POST | `/search/xray/tool` | Tool call manual (JSON) |
| GET | `/search/xray/cities/nearby` | Probe cidades |

### Body `/chat`

```json
{
  "session_id": "uuid-opcional",
  "message": "Procuro embalagens em Campinas, raio 40km",
  "final_limit": 10,
  "debug": false,
  "rerank": false
}
```

### Resposta (resumo)

```json
{
  "session_id": "...",
  "reply": "texto para o usuário",
  "messages": [{ "role": "user|assistant", "content": "..." }],
  "actions": [{ "tool": "search_suppliers", "result_count": 10 }],
  "mcp_tool_call": { "name": "search_text", "arguments": {} },
  "search": { "results": [] },
  "query_manager": {},
  "geo": {}
}
```

## Modos na UI

1. **Conversa** — chat + painel X-Ray (última busca) + resultados  
2. **Tool call manual** — JSON direto em `search_text`  
3. **Probes** — health, config, cities, contrato MCP  

## Env

| Variável | Default | Uso |
|----------|---------|-----|
| `CITIES_API_URL` | Railway cities | Expansão geo |
| `XRAY_CHAT_TTL_MS` | 3600000 | TTL sessão |
| `XRAY_CHAT_MAX_MESSAGES` | 40 | Cap histórico |
| `XRAY_CHAT_MAX_TOOL_ROUNDS` | 4 | Loop tool calling |
| `LLM_CHAT_AGENT_MODEL` | `gpt-4o-mini` | Modelo do chat |

## Railway

Após deploy: `https://<dominio>/search/xray`.
