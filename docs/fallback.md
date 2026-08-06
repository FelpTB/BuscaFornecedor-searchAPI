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

CNPJs já retornados entram em `filter_not.cnpj`.

### Modos

| mode | Quando | Comportamento |
|------|--------|----------------|
| `fill` | Busca veio curta (`result_count < final_limit`) | Mantém anteriores e completa com novos |
| `replace` | Cota já cheia mas irrelevante, ou usuário pediu nacional sem repetir | Devolve **só** empresas novas do escopo ampliado |
| `auto` | Default da tool | `replace` se já havia `final_limit` resultados; senão `fill` |

`scope`: `auto` | `uf` | `nacional` — se o usuário pedir "busca nacional", a tool deve usar `scope=nacional` e `mode=replace`.

**Bug corrigido (2026-08-06):** se a busca regional já enchia o `final_limit`, a cascata saía cedo e **não** removia o filtro de cidade — parecia “mesmos resultados de Varginha”. Agora sempre executa os estágios amplos e, em `replace`, prioriza empresas novas.

## Código

- Núcleo: `src/search/fallbackSearch.js` (`runFallbackCascade`)
- Tool do chat: `expand_search_fallback` em `src/xray/conversationalAgent.js`

Envio de e-mail/SMS continua no n8n; a API só orquestra a fila após a busca (inclui resultados do fallback via telemetria quando a tool dispara `onSearchCompleted`).
