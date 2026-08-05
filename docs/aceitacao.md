# Critérios de Aceite (Definition of Done)

Checklist de produto para considerar a **API de busca em funcionamento completo**.  
Última verificação no código deste repo: **2026-08-05**.

Legenda: `[x]` concluído neste repositório · `[ ]` pendente.

---

### Critérios

- [x] A API/MCP capta corretamente os parâmetros e IDs de consulta vindos do front-end.
- [ ] O Módulo de Busca consegue identificar o usuário corretamente (Subtarefa 2.4).
- [x] O Filtro de Localidade determina com precisão as cidades dentro do raio pesquisado.
- [x] O Query Manager vetoriza as buscas e aplica pesos, BM25 e filtros de payload sem erros.
- [ ] O Qdrant retorna as empresas corretamente de acordo com os critérios, e o registro de histórico é salvo no Supabase com os parâmetros usados e resultados obtidos.
- [ ] O Contador de Aparições rastreia os CNPJs, aciona o Supabase e incrementa o número de exibições conforme o esperado.
- [ ] O Fallback Vector identifica resultados insuficientes, limpa CNPJs já listados e escala as buscas para níveis estaduais (UF) ou Nacionais com sucesso.
- [ ] O Módulo de Envios coloca os alvos em fila e realiza o disparo de SMS e e-mails periodicamente.
- [ ] Todo o fluxo opera de maneira fluida em código, eliminando completamente a dependência da plataforma n8n.

---

### Verificação (estado atual do código)

| Critério | Status | Evidência / ressalva |
|----------|--------|----------------------|
| Parâmetros e IDs | **Feito** | Schema Zod em [`src/schemas/searchText.js`](../src/schemas/searchText.js); parity REST↔MCP; `search_id` e `X-Request-Id` gerados/aceitos no servidor ([`src/middleware/auth.js`](../src/middleware/auth.js), [`requestId.js`](../src/middleware/requestId.js)). |
| Identificar usuário (2.4) | **Pendente** | `AUTH_MODE=off\|api_key` local; `req.auth.userId` sempre `null`. JWT Supabase planejado ([`adr/009-supabase-auth.md`](../adr/009-supabase-auth.md), [`docs/supabase-users.md`](supabase-users.md)) — sem client Supabase no runtime. |
| Filtro de localidade | **Feito** | [`src/clients/citiesApi.js`](../src/clients/citiesApi.js) → API-busca-cidades; X-Ray/agente monta `filter.cidade` como lista de nomes. REST/MCP aceitam a lista já expandida em `filter`. |
| Query Manager / pesos / BM25 / filtros | **Feito** | [`executeSearchByText`](../src/searchService.js) + dual-path RRF ([`multiVectorSearch.js`](../src/multiVectorSearch.js)); planner QM no X-Ray ([`searchAgent.js`](../src/xray/searchAgent.js)). |
| Qdrant **e** histórico Supabase | **Parcial** | Retorno Qdrant **ok**. Persistência em `busca_fornecedor.consultas` (ou `searches`) **não implementada** neste repo — ver [`PLANO_ESCALAVEL.md`](PLANO_ESCALAVEL.md) Fase 2 / cold path. Critério composto permanece aberto até o histórico. |
| Contador de Aparições | **Pendente** | Sem código de contagem de CNPJ/exibições. Spec em [`GUIA_IMPLEMENTACAO.md`](GUIA_IMPLEMENTACAO.md). |
| Fallback Vector (cidade → UF → nacional) | **Pendente** | Sem loop progressivo de relaxamento / exclusão de CNPJs. Spec em GUIA §3.8 / [`workers.md`](workers.md). |
| Módulo de Envios (SMS/e-mail) | **Pendente** | Sem fila de disparo nem workers de envio neste repo. |
| Fluxo completo sem n8n | **Parcial** | Hot path de busca (REST/MCP/X-Ray) já roda em Node **sem** n8n. O DoD completo só fecha quando histórico, identidade, fallback, contador e envios estiverem no código. |

### O que *não* foi marcado a mais

Nenhum item além dos três `[x]` acima foi promovido a concluído:

- O retorno do **Qdrant** já funciona, mas o critério 5 exige **também** o histórico no Supabase.
- A API de busca **já independe de n8n** no hot path, mas o critério 9 fala do **fluxo completo** de produto.

### Próximos passos sugeridos (ordem)

1. **Identidade + histórico + aparições** — seguir [`plano-supabase-auth.md`](plano-supabase-auth.md) (fases S0–S3); ADR 010  
2. Fallback Vector — critério 7  
3. Módulo de Envios — critério 8  
4. Fechar critério 9 quando 2–8 estiverem no código

Skill Cursor: `.cursor/skills/supabase-db/`

Ver também: [`PLANO_ESCALAVEL.md`](PLANO_ESCALAVEL.md), [`GUIA_IMPLEMENTACAO.md`](GUIA_IMPLEMENTACAO.md).
