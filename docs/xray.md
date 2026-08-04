# X-Ray — pré-proxy Microsoft (Copilot + MCP)

UI de teste embutida nesta API: [`/search/xray`](../src/xray/).

## Papel

Simula o fluxo que será usado no ambiente Microsoft:

1. Usuário fala em linguagem natural (ou envia tool call manual)
2. Agente LLM monta argumentos da tool MCP `search_text` (como um Copilot)
3. A **mesma** lógica de `executeSearchByText` / tool MCP executa a busca
4. Painel X-Ray mostra tool call, weights, filters, meta e resultados

Não é o cliente Microsoft final — é o **pré-proxy** para validar a API antes da integração.

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
