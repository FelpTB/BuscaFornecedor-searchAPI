# Criterios de Aceite (Definition of Done)

Checklist de produto para a **migracao n8n → API+MCP**.  
Ultima verificacao no codigo: **2026-08-06**.

Legenda: `[x]` concluido neste repositorio · `[~]` parcial · `[ ]` pendente.

---

### Decisao de fronteira (2026-08-06)

**Envio / orquestracao pos-fila permanece no n8n + notificacao-clientes.**  
A searchAPI **nao** implementa claim, disparo e-mail/SMS, confirmar-consumo, sweep, creditos, blacklist nem unsubscribe.

Responsabilidade da API no modulo de envios: **orquestrar a fila** — apos busca autenticada, inserir alvos via `POST …/recebe-consulta`. O n8n continua agendando claim → envio → confirmacao.

**Fallback Vector:** o agente pergunta se o usuario deseja busca mais geral quando `result_count < final_limit` ou quando ha reclamacao sobre o resultado; so apos confirmacao executa cascata cidade → UF → nacional (sem CNPJs duplicados), visando completar o limite pedido.

---

### Criterios (Fase 1 / Notion)

- [x] A API/MCP capta corretamente os parametros e IDs de consulta vindos do front-end.
- [x] O Modulo de Busca identifica o usuario (auth hibrida: API key / JWT + register/login).
- [x] O Filtro de Localidade determina cidades no raio (Cities API).
- [x] O Query Manager vetoriza, aplica pesos, BM25 e filtros de payload.
- [x] Qdrant + historico Supabase (`consultas` status `concluida`, parametros e resultados).
- [x] Contador de Aparicoes + tabela `aparicoes` + `contador_aparicoes`.
- [x] Fallback Vector (agente pergunta → `expand_search_fallback` → cascata UF/nacional).
- [x] Orquestracao da fila (insert `recebe-consulta`) — codigo pronto; homologacao ops pendente.
- [~] Fluxo de busca em codigo (Main/QM/localidade/historico/contador/fila/fallback). Envio periodico permanece n8n **por desenho**.

---

### Mapa n8n → responsabilidade (2026-08-06)

| Modulo n8n (Document Hub) | Status | Dono |
|---------------------------|--------|------|
| Main / Webhook busca | Feito | searchAPI |
| Query Manager | Feito | searchAPI |
| Filtro localidade | Feito | searchAPI |
| Contador Aparicoes | Feito | searchAPI |
| Historico consulta | Feito | searchAPI |
| Identidade usuario | Feito | searchAPI |
| Insere fila e-mail (pos-busca) | Feito (codigo) | searchAPI → notificacao |
| Fallback Vector | Feito (agente + cascata) | searchAPI |
| Timer claim / envio e-mail-SMS / confirmar-consumo | Fora do escopo API | n8n + notificacao-clientes |
| Sweep / reenvio / verificar creditos | Fora do escopo API | n8n + notificacao |
| Creditos mensal / blacklist / unsubscribe | Fora do escopo API | n8n + outros |

### Verificacao operacional pendente

1. Alinhar `DATABASE_URL` / `SUPABASE_URL` da searchAPI com o Postgres da API de notificacao (`POSTGRES_SCHEMA=busca_fornecedor`).
2. Validar no X-Ray aba **5 · Fila email**: `ok > 0` apos busca autenticada (sem 404).
3. Confirmar claim/envio n8n consumindo a fila gerada pela API.
4. Validar no chat X-Ray: busca curta → pergunta → "sim" → `expand_search_fallback` completa resultados.

### Proximos passos (ordem)

1. Homologar fila e-mail ponta a ponta (persist → recebe-consulta → n8n claim).
2. Homologar Fallback no X-Ray chat (perguntar → confirmar → UF/nacional).
3. Fechar Fase 1 de busca quando fila + fallback estiverem estaveis em producao (n8n permanece no envio).

Docs: `docs/comms.md`, `docs/fallback.md`, `docs/auth.md`, `docs/implementacao-supabase.md`.
