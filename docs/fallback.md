# Fallback Vector

Objetivo: quando a busca regional devolve **menos resultados** que o `final_limit` pedido (ou o usuário reclama da qualidade/quantidade), o agente **pergunta** se deseja uma busca mais geral e, só após confirmação, amplia o escopo.

## Comportamento (agente X-Ray)

1. `search_suppliers` roda a busca normal (cidade/raio quando houver).
2. Se `result_count < requested_limit` (`suggest_broader_search: true`), o assistente **pergunta** se quer busca mais geral — **não** dispara o fallback sozinho.
3. Se o usuário reclamar dos resultados, o assistente também pergunta (a menos que o pedido de expansão já seja explícito).
4. Com confirmação (ou pedido explícito), chama `expand_search_fallback`.

## Cascata

| Estágio | Filtro |
|---------|--------|
| Original | `filter.cidade` (lista regional) ± demais |
| `uf` | remove cidade; mantém `uf` + filtros de negócio |
| `nacional` | remove cidade e UF; mantém `modelo_negocio` etc. |

CNPJs já retornados entram em `filter_not.cnpj`. Resultados são mesclados sem duplicata até `final_limit`.

## Código

- Núcleo: `src/search/fallbackSearch.js` (`runFallbackCascade`)
- Tool do chat: `expand_search_fallback` em `src/xray/conversationalAgent.js`

Envio de e-mail/SMS continua no n8n; a API só orquestra a fila após a busca (inclui resultados do fallback via telemetria quando a tool dispara `onSearchCompleted`).
