# X-Ray — pré-proxy Microsoft (Copilot + MCP)

UI de teste embutida nesta API: [`/search/xray`](../src/xray/).

## Papel

Simula o **Query Manager B2B** (prompt de engenharia de busca) + bridge para MCP:

1. Classifica intent: `PRODUTO` | `SERVICO` | `MISTO`
2. Aplica **pesos fixos** (servidor — LLM não inventa pesos):
   - `bm25=0.20`, `descricao=0.15`, `publico=0.03`, `cliente=0.02`
   - Núcleo 0.60: produto/serviço conforme intent
3. Gera textos por dimensão + **BM25 discriminante** (sem substantivo genérico compartilhado)
4. `Modelo_Negocio` → `filter.modelo_negocio`
5. Executa `search_text` (mesmo núcleo REST/MCP)

Painel X-Ray: abas `mcp_tool_call`, `query_manager`, `weights`, `queries/filters`, `meta`.


## Endpoints

| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/search/xray` | UI HTML |
| POST | `/search/xray/run` | Agente NL → `search_text` |
| POST | `/search/xray/tool` | Tool call manual (JSON) |

Body `/run`: `{ "query": "...", "final_limit": 10, "debug": false, "rerank": false }`  
Body `/tool`: `{ "arguments": { "query": "...", "weights": {...}, "filter": {...}, ... } }`

## Modos na UI

1. **Agente (NL → MCP)** — planejamento LLM + busca  
2. **Tool call manual** — testa filtros/pesos/BM25/rerank/debug sem LLM  
3. **Probes** — `/health`, `/config`, contrato das tools MCP  

Campo opcional de API key na UI quando `AUTH_MODE=api_key`.

## Railway

Após deploy, abra `https://<dominio>/search/xray`. Healthcheck continua em `/health` (inclui `search_xray` no JSON).
