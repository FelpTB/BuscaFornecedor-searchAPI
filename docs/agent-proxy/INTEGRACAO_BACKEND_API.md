# Integração: BuscaFornecedor API+MCP ↔ Agent-Proxy (Teams / Copilot)

> Documento de mapeamento para o **front** (Agent-Proxy no ecossistema Microsoft) consumir o **backend** já implementado neste repositório.  
> Requisitos de certificação do proxy: [REQUISITOS_AGENT_PROXY.md](./REQUISITOS_AGENT_PROXY.md).  
> Referência completa de endpoints/MCP: [../api/REFERENCE.md](../api/REFERENCE.md).  
> **Verdade operacional:** `src/`. Visões futuras (BullMQ, Entra nativo no backend) = Notion — não assumir implementado.

---

## 1. Papéis

| Camada | Onde | Responsabilidade |
|--------|------|------------------|
| **UI conversacional** | Teams / M365 Copilot | Mensagens, Adaptive Cards, FRE, Help, aviso de IA, Report |
| **Agent-Proxy** | Azure App Service + Bot Service | OAuth Entra, typing &lt;3s, tradução Teams↔REST, sanitização, escopos mínimos |
| **API + MCP** | Railway (`busca-fornecedor-api-mcp`) | Busca híbrida, auth comprador, telemetria async, conversas |
| **Dados** | Qdrant + OpenAI + Supabase | Vetores, embeddings/rerank, histórico/consultas/aparições |

O proxy **não** reimplementa `searchService`. Toda busca de fornecedores passa por `POST /search/text` (ou tool MCP `search_text` se o runtime do agent usar MCP).

---

## 2. Arquitetura de integração

```
┌─────────────────────────────────────────────────────────────┐
│  Microsoft Teams / M365 Copilot                             │
└──────────────────────────┬──────────────────────────────────┘
                           │ Bot Framework activities
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Agent-Proxy (Azure)                                        │
│  • Entra OAuth / token validation                           │
│  • Typing indicator se latência > 3s                        │
│  • Intent: busca | ajuda | greeting | dead-end              │
│  • Adaptive Cards a partir de mapResultsForDisplay          │
│  • Aviso IA + botão Report                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS TLS 1.2+
                           │ Authorization: Bearer <credencial>
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  BuscaFornecedor API (Express) — Railway                    │
│  GET  /health                                               │
│  GET  /config                                               │
│  POST /search/text          ← hot path                      │
│  GET|POST /auth/*           ← comprador / API keys          │
│  GET|DELETE /conversations* ← histórico (autenticado)       │
│  POST /mcp                  ← parity MCP (opcional p/ agent)│
└──────┬──────────────┬──────────────┬────────────────────────┘
       │              │              │
       ▼              ▼              ▼
   OpenAI         Qdrant         Supabase
  embed/rerank   dual-path RRF   auth + telemetria async
```

---

## 3. Endpoints que o Agent-Proxy deve usar

### 3.1 Hot path (obrigatório para busca)

| Método | Path | Auth | Uso no proxy |
|--------|------|------|--------------|
| `GET` | `/health` | pública | Probe / readiness Azure |
| `GET` | `/config` | conforme `AUTH_MODE` | Descobrir dimensões, filtros allowlist, limites — cachear no startup |
| `POST` | `/search/text` | `assertCanSearch` (API key ou JWT) | Toda consulta de fornecedores |

**Request body (Zod compartilhado REST+MCP)** — ver `src/schemas/searchText.js`:

| Campo | Obrigatório | Notas para o proxy |
|-------|-------------|--------------------|
| `query` | sim | Texto do usuário (já sanitizado no proxy) |
| `filter` | não | Ex.: `{ "uf": "SP" }`, `{ "cidade": "..." }` — só chaves allowlist |
| `filter_not` | não | Exclusões full-text/keyword |
| `final_limit` | não | Default do servidor; manter baixo no Teams (ex. 5–10) para cards |
| `rerank` | não | `true` melhora qualidade, **aumenta latência** — preferir off no 1º turno se &lt;3s for crítico |
| `weights` / `queries` / `bm25` | avançado | Só se o agent extrair intent estruturado |

**Response (resumo):**

```json
{
  "search_id": "uuid",
  "results": [
    {
      "posicao": 1,
      "score_final": 0.0,
      "payload": { "nome_empresa": "...", "uf": "...", "cidade": "...", "descricao": "...", "site": "...", "modelo_negocio": "...", "cnpj": "..." }
    }
  ],
  "auth": { },
  "telemetry_queued": true
}
```

Header útil: `X-Search-Id` — correlacionar Report / logs do proxy com telemetria backend.

### 3.2 Auth (onboarding / identidade)

| Método | Path | Uso no proxy |
|--------|------|--------------|
| `GET` | `/auth/me` | Quem é a credencial atual |
| `POST` | `/auth/register-buyer` | Cadastro comprador (rate-limited) — se o fluxo Teams precisar criar conta |
| `POST` | `/auth/login-buyer` | Email+senha → API key (quando `LOGIN_MINT_API_KEY` permitir) |
| `POST` | `/auth/api-keys` | Emitir key para usuário já autenticado |
| `POST` | `/auth/api-keys/revoke` | Revogar key |

**Modo atual (`AUTH_MODE=api_key,supabase_jwt`):**

- Bearer `sk_bf_…` (API key) **ou** JWT Supabase.
- Shape Entra-ready (`provider` em `AuthContext`), mas **Entra OAuth vive no proxy**; o backend ainda não valida tokens Entra nativamente.

**Padrão recomendado de integração (Fase 3):**

1. Usuário autentica no Teams via Entra (OAuth do bot / SSO).
2. Proxy valida token Entra (JWKS).
3. Proxy chama o backend com **credencial de serviço** (API key de serviço no Key Vault) **e** propaga identidade estável (`user_id` / claims mapeados) quando o contrato de autenticação Entra no backend estiver pronto.
4. Até lá: mapear usuário Entra → comprador Supabase (login/register) ou usar service key com telemetria limitada — **não** embutir service role / keys no manifest.

### 3.3 Histórico de conversas (opcional no Teams)

| Método | Path | Uso |
|--------|------|-----|
| `GET` | `/conversations` | Listar histórico do comprador |
| `GET` | `/conversations/:id` | Retomar thread |
| `DELETE` | `/conversations/:id` | Apagar |

Requer `userId` autenticado. O Bot Framework já tem conversationId próprio — decidir se o histórico Teams espelha Supabase ou fica só no canal.

### 3.4 MCP (alternativa)

| Tool MCP | REST equivalente |
|----------|------------------|
| `get_config` | `GET /config` |
| `search_text` | `POST /search/text` |
| `list_conversations` / `get_conversation` / `delete_conversation` | `/conversations*` |

Se o Custom Engine Agent no Toolkit preferir MCP Streamable HTTP (`/mcp`), usar as mesmas tools — **mesma** lógica `searchService`. Para Bot Framework clássico, REST é o caminho mais simples.

### 3.5 Fora do escopo do Agent-Proxy

| Path | Motivo |
|------|--------|
| `/search/xray` | Harness QA — desligar em produção (`XRAY_ENABLED=0`) |
| Chamadas diretas a Qdrant / OpenAI / Supabase service role | Só no backend |
| `recebe-consulta` / e-mail SMS | n8n + notificacao-clientes; API só enfileira pós-busca |

---

## 4. Tradução de contratos: backend → Adaptive Cards

Usar o mesmo contrato de exibição de `src/search/resultDisplay.js` → `mapResultsForDisplay(results)`:

| Campo display | Uso no Adaptive Card |
|---------------|----------------------|
| `nome_empresa` | Título |
| `local` | Subtítulo (UF · Cidade) |
| `modelo_negocio` | Fact / badge |
| `descricao` | Texto truncado (já ≤400 chars no mapper) |
| `site` / `site_label` | Action `OpenUrl` |
| `perfil_url` | Action `OpenUrl` → buscafornecedor.com.br/perfil/{cnpj_basico} |
| `posicao` | Ordem na lista / carrossel |

**Regras UX (certificação):**

- Preferir **um card por fornecedor** ou um container com até N itens (mobile-safe).
- Incluir rodapé fixo: “Resposta gerada por IA” + action **Report** (payload com `search_id` + `posicao` / id).
- Comandos: Olá / Ajuda tratados **no proxy** (sem chamar `/search/text`).
- Dead-end: mensagem + lista de exemplos de busca (sem inventar fornecedores).

---

## 5. Latência e typing indicator

| Etapa | Onde | Nota |
|-------|------|------|
| Validação + intent | Proxy | &lt;100 ms típico |
| Embeddings OpenAI | Backend | Variável |
| Qdrant dual-path RRF | Backend | Variável |
| Rerank LLM (`rerank: true`) | Backend | Pode estourar 3 s facilmente |

**Contrato operacional:**

1. Ao receber mensagem de busca → **typing imediatamente**.
2. Chamar `POST /search/text` com timeout alinhado a `SEARCH_TIMEOUT_MS` (backend).
3. Se &gt;3 s sem resposta → manter typing (já disparado).
4. Em erro 4xx/5xx → Adaptive Card de erro amigável + Ajuda (nunca stack trace).

Hot path do backend **não** espera write Supabase (telemetria async) — o proxy não precisa aguardar `telemetry_queued`.

---

## 6. Segurança na fronteira proxy ↔ API

| Controle | Proxy | Backend (já existe) |
|----------|-------|---------------------|
| TLS 1.2+ / HSTS | Azure App Service + config | Railway HTTPS + Helmet |
| Validar Bearer Entra | Sim (obrigatório) | JWT Supabase / API key hoje |
| Sanitizar input Teams | Sim | Zod + allowlist filtros |
| Secrets | Key Vault | Env Railway (nunca commit) |
| Rate limit | Opcional no proxy | Já em `/search/text` e auth |
| Isolamento tenant | Não misturar tokens/orgs em memória | `userId` em consultas/conversas; `org_id` = roadmap |
| Logs PII | Criptografar / minimizar | Não logar JWT/API key completa |

**PoLP manifest:** escopos de bot mínimos para conversa + busca; sem permissões de Files/Mail desnecessárias.

---

## 7. Fluxos de UX ↔ APIs

### 7.1 First Run Experience (FRE)

1. Install / conversationUpdate → mensagem proativa no proxy (texto local, sem API).
2. Opcional: `GET /config` para listar capacidades reais (filtros UF, etc.).
3. Se exigir conta: deep-link ou fluxo `register-buyer` / SSO Entra.

### 7.2 Busca feliz

1. Usuário: “fornecedores de energia solar em SP”.
2. Proxy: extrai `query` + `filter.uf=SP` (NLP leve no proxy **ou** manda `query` crua).
3. Typing → `POST /search/text`.
4. Map `results` → Adaptive Cards + aviso IA + Report.

### 7.3 Ajuda / Olá

1. Resposta estática no proxy (sem backend).
2. Exemplos de prompts alinhados ao produto.

### 7.4 Report de conteúdo IA

1. Action do card envia `search_id`, trecho, motivo.
2. Proxy grava em log de auditoria (90 dias) e/ou webhook interno.
3. Opcional futuro: endpoint de moderação no backend (ainda não existe em `src/`).

---

## 8. Variáveis / config que o time do proxy precisa

| Variável (lado proxy) | Descrição |
|-----------------------|-----------|
| `BUSCA_API_BASE_URL` | URL pública Railway da API |
| `BUSCA_API_KEY` ou mecanismo SSO | Credencial para `Authorization: Bearer` (Key Vault) |
| Bot App ID / Secret | Entra — Key Vault |
| Timeout HTTP | ≥ tempo típico de busca; &lt; timeout do Bot Framework |

Espelhar limites e filtros via `GET /config` em runtime — não hardcodar nomes de vetores/filtros no proxy.

---

## 9. Checklist de parity (DoD integração)

- [ ] Proxy chama só a API pública (não Qdrant/OpenAI direto)
- [ ] Typing indicator se busca &gt; 3 s
- [ ] Resultados em Adaptive Cards a partir do contrato `mapResultsForDisplay`
- [ ] FRE + Olá + Ajuda + dead-ends sem chamar busca
- [ ] Aviso de IA + Report com `search_id`
- [ ] Segredos só em Key Vault
- [ ] Token Entra validado antes do forward
- [ ] Mobile Teams sem overflow horizontal
- [ ] `GET /health` usado no healthcheck Azure
- [ ] Escopos `manifest.json` mínimos

---

## 10. O que já existe no backend vs. o que o proxy entrega

| Capacidade | Backend (`src/`) hoje | Agent-Proxy (a desenvolver) |
|------------|----------------------|-----------------------------|
| Busca híbrida Qdrant+OpenAI | Sim | Consome |
| MCP tools parity | Sim | Opcional |
| Auth API key / JWT Supabase | Sim | Bridge Entra → backend |
| Telemetria consultas/aparições | Async | Só correlaciona `search_id` |
| Adaptive Cards / FRE / Help | Não (X-Ray é harness web) | Sim |
| Typing Teams | Não | Sim |
| Report IA UI | Não | Sim |
| Entra OAuth nativo | Shape ready; não validado | Sim (Fase 3) |

---

## Referências de código

| Área | Path |
|------|------|
| Rotas REST | `src/routes/index.js` |
| Schema busca | `src/schemas/searchText.js` |
| Núcleo busca | `src/searchService.js` |
| Display cards | `src/search/resultDisplay.js` |
| Auth | `src/auth/resolveAuth.js`, `src/middleware/auth.js` |
| MCP | `src/mcp/createMcpServer.js` |
| App / health | `src/app.js` |
