# BuscaFornecedor API Reference

**Version:** 1.0.0  
**Protocol:** HTTPS · JSON (UTF-8) · MCP Streamable HTTP  
**Runtime:** Node.js 20+ (ESM) · Express  
**Deploy:** Railway  

Esta é a referência oficial da API + MCP de busca híbrida B2B. Use-a para integrar clientes REST, agentes MCP e o **Agent-Proxy** (Microsoft Teams / M365 Copilot).

| Documento relacionado | Conteúdo |
|-----------------------|----------|
| [GUIA.md](./GUIA.md) | **Comece aqui:** conceitos, primeiros passos, pré-configurações, boas práticas |
| [ENDPOINTS.md](./ENDPOINTS.md) | **Catálogo por rota:** funcionamento, input e output |
| `GET /docs` | Esta documentação navegável, servida pela própria API |
| [Requisitos Agent-Proxy](../agent-proxy/REQUISITOS_AGENT_PROXY.md) | Certificação Microsoft / Azure |
| [Integração Agent-Proxy](../agent-proxy/INTEGRACAO_BACKEND_API.md) | Mapeamento Teams ↔ esta API |
| Código (`src/`) | Fonte da verdade operacional |

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Base URL e descoberta](#2-base-url-e-descoberta)
3. [Autenticação](#3-autenticação)
4. [Convenções](#4-convenções)
5. [Erros](#5-erros)
6. [Rate limits](#6-rate-limits)
7. [Endpoints REST](#7-endpoints-rest) → detalhe completo em [ENDPOINTS.md](./ENDPOINTS.md)
8. [Busca: contrato detalhado](#8-busca-contrato-detalhado)
9. [MCP Streamable HTTP](#9-mcp-streamable-http)
10. [Tools MCP](#10-tools-mcp)
11. [Contrato de exibição (UI / Adaptive Cards)](#11-contrato-de-exibição-ui--adaptive-cards)
12. [X-Ray (harness QA)](#12-x-ray-harness-qa)
13. [Arquitetura interna (para integradores)](#13-arquitetura-interna-para-integradores)
14. [Guia rápido Agent-Proxy](#14-guia-rápido-agent-proxy)
15. [OpenAPI-like cheat sheet](#15-openapi-like-cheat-sheet)

---

## 1. Visão geral

A API expõe **busca híbrida de fornecedores** (vetores densos + BM25, fusão dual-path RRF, rerank LLM opcional) e serviços auxiliares de **identidade do comprador**, **histórico de conversas** e **telemetria assíncrona**.

```
Cliente (REST | MCP | Agent-Proxy)
        │
        ▼
┌───────────────────────────────────────┐
│  Express (portas)                     │
│  auth · validação Zod · rate limit    │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│  searchService (núcleo compartilhado) │
│  embeddings → Qdrant → display        │
└───────────────────┬───────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
     OpenAI      Qdrant      Supabase
   embed/rerank  dual-path   auth + async
                             telemetry
```

**Princípios:**

- REST e MCP compartilham o **mesmo** `searchService`.
- Hot path de busca **não espera** write no Supabase (telemetria/comms = async).
- Filtros são **allowlisted** (não aceitam SQL/código do cliente).
- Secrets só em variáveis de ambiente.

---

## 2. Base URL e descoberta

| Ambiente | Base URL |
|----------|----------|
| Produção (Railway) | `https://<seu-serviço>.up.railway.app` |
| Local | `http://127.0.0.1:3000` (ou `PORT`) |

**Descoberta:**

```http
GET /health
GET /config
GET /docs
```

`GET /health` — liveness / metadados do processo.  
`GET /config` — contrato público da busca (dimensões, filtros, pré-configurações de pesos, foco, BM25, limites, auth, tools MCP).  
`GET /docs` — documentação navegável (guia, catálogo de endpoints e esta referência).

---

## 3. Autenticação

### 3.1 Modos (`AUTH_MODE`)

CSV no ambiente. Produção típica:

```text
AUTH_MODE=api_key,supabase_jwt
```

| Modo | Significado |
|------|-------------|
| `off` | Sem auth (somente local/dev) |
| `api_key` | Aceita API key (`sk_bf_…` ou key de env) |
| `supabase_jwt` | Aceita JWT de sessão Supabase Auth |

### 3.2 Headers

Envie **um** dos formatos:

```http
Authorization: Bearer sk_bf_<plaintext>
Authorization: Bearer <supabase_access_token>
X-Api-Key: sk_bf_<plaintext>
```

A API key em plaintext é mostrada **uma única vez** no cadastro/login/emissão. O servidor armazena apenas `key_hash` + `key_prefix`.

### 3.3 Quem precisa de auth?

| Recurso | Anônimo | Autenticado |
|---------|---------|-------------|
| `GET /health` | ✅ | ✅ |
| `GET /docs*` | ✅ | ✅ |
| `GET /config` | ✅* | ✅ |
| `POST /auth/register-buyer` | ✅ (público, rate-limited) | — |
| `POST /auth/login-buyer` | ✅ (público, rate-limited) | — |
| `POST /auth/refresh` | ✅ (com `refresh_token`, rate-limited) | — |
| `GET /auth/me` | responde `authenticated: false` | perfil |
| `GET/PATCH /auth/consultas/:searchId*` | ❌ | ✅ (`userId`, só as próprias) |
| `POST /search/text` | ❌ se `AUTH_MODE ≠ off` | ✅ + scope `search` |
| `GET/DELETE /conversations*` | ❌ | ✅ (`userId`) |
| `POST /mcp` | ❌ se auth ligada | ✅ |

\* Com `AUTH_MODE` ativo, `/config` permanece acessível via middleware opcional (útil para o client montar UI). A **busca** exige credencial.

### 3.4 Gate de comprador (`REQUIRE_COMPRADOR`)

Quando `REQUIRE_COMPRADOR=1`:

1. Usuário autenticado deve ter perfil em `usuario_comprador`.
2. Cota `buscas_realizadas < limite_buscas` é verificada no hot path.

### 3.5 Fluxo recomendado (cliente / Agent-Proxy)

```
1. POST /auth/register-buyer  →  api_key (guarde!)
   ou POST /auth/login-buyer  →  api_key e/ou access_token
2. GET  /config               →  filtros e limites
3. POST /search/text          →  Authorization: Bearer <api_key>
4. (opcional) correlacionar Report com header X-Search-Id / body.search_id
```

**Agent-Proxy + Entra:** valide OAuth Entra no Azure; encaminhe ao backend uma **credencial de serviço** (API key no Key Vault). Não embuta secrets no `manifest.json`.

---

## 4. Convenções

### 4.1 Content-Type

```http
Content-Type: application/json; charset=utf-8
Accept: application/json
```

Body JSON limitado a **2 MB** (`LIMITS.bodyJsonBytes`).

### 4.2 Correlação

| Header | Direção | Descrição |
|--------|---------|-----------|
| `X-Request-Id` | request/response | Se omitido no request, a API gera UUID |
| `X-Search-Id` | response (`POST /search/text`) | UUID da busca (também em `body.search_id`) |

### 4.3 Encoding e idioma

- JSON UTF-8.
- Mensagens de erro em português.
- Campos de filtro keyword (`uf`, etc.) são normalizados no servidor (maiúsculas / sem acento, conforme regra do campo).

### 4.4 Idempotência

Buscas **não** são idempotentes (cada chamada gera novo `search_id` e pode enfileirar telemetria). Cadastro de e-mail existente retorna `400` com hint `login-buyer`.

---

## 5. Erros

### 5.1 Envelope padrão

```json
{
  "error": "Mensagem legível",
  "code": "BAD_REQUEST",
  "details": {},
  "request_id": "uuid"
}
```

| HTTP | `code` típico | Quando |
|------|---------------|--------|
| 400 | `BAD_REQUEST` | Validação Zod / filtros inválidos / body |
| 401 | `UNAUTHORIZED` | Sem credencial ou inválida |
| 403 | `FORBIDDEN` | Sem scope `search`, sem comprador, cota esgotada |
| 404 | `NOT_FOUND` | Rota ou recurso inexistente |
| 429 | — | Rate limit (`Too many …`) |
| 502 | `AUTH_CREATE_FAILED` etc. | Falha upstream Auth |
| 503 | `SERVICE_UNAVAILABLE` | Supabase/OpenAI não configurado |
| 500 | `INTERNAL_ERROR` | Erro não tipado |

### 5.2 Exemplo

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": "Busca requer autenticação. Crie conta (register-buyer), faça login (login-buyer) ou envie Bearer/X-Api-Key.",
  "code": "UNAUTHORIZED",
  "request_id": "a1b2c3d4-…"
}
```

---

## 6. Rate limits

| Superfície | Janela | Máximo | Chave |
|------------|--------|--------|-------|
| Auth (`register-buyer`, `login-buyer`) | 15 min | 10 | IP |
| `POST /search/text` | 60 s | 120 | `keyPrefix` ou IP |
| MCP `/mcp` | 60 s | 120 | `keyPrefix` / `userId` / IP |
| X-Ray chat/run | 60 s | 180 | `keyPrefix` ou IP |

Resposta típica de limite: HTTP 429 com mensagem `"Too many …"`.

---

## 7. Endpoints REST

> **Catálogo completo (funcionamento + input + output de cada rota):**  
> **[ENDPOINTS.md](./ENDPOINTS.md)**

Resumo rápido — detalhes, schemas e exemplos estão no catálogo:

| Método | Path | Auth | Função |
|--------|------|------|--------|
| `GET` | `/health` | pública | Liveness + metadados |
| `GET` | `/config` | opcional | Contrato da busca (cachear) |
| `POST` | `/auth/register-buyer` | pública + RL | Cadastro + 1ª API key |
| `POST` | `/auth/login-buyer` | pública + RL | Login → key e/ou JWT |
| `POST` | `/auth/refresh` | pública + RL | Renova JWT com `refresh_token` |
| `GET` | `/auth/me` | opcional | Credencial + perfil |
| `POST` | `/auth/api-keys` | autenticado | Emite nova key |
| `POST` | `/auth/api-keys/revoke` | autenticado | Revoga por `key_prefix` |
| `GET` | `/auth/consultas/:searchId` | `userId` | Probe telemetria |
| `PATCH` | `/auth/consultas/:searchId/qualidade` | `userId` | Avaliação do comprador (Ótimo/Bom/Ruim/Péssimo) |
| `GET` | `/auth/aparicoes/:cnpj` | autenticado | Contador aparições |
| `GET` | `/conversations` | `userId` | Lista histórico |
| `GET` | `/conversations/:id` | `userId` | Conversa + mensagens |
| `DELETE` | `/conversations/:id` | `userId` | Exclui conversa |
| `POST` | `/search/text` | `assertCanSearch` | Busca híbrida (hot path) |
| `POST/GET/DELETE` | `/mcp` | conforme `AUTH_MODE` | MCP Streamable HTTP |
| `GET` | `/docs`, `/docs/:slug`, `/docs/:slug.md` | pública | Documentação navegável / markdown |

Cada ficha em [ENDPOINTS.md](./ENDPOINTS.md) inclui: o que faz, como funciona, tabela de input, JSON de output e erros.

---

## 8. Busca: contrato detalhado

> Campos do body, filtros allowlist e exemplos também estão na ficha  
> [`POST /search/text`](./ENDPOINTS.md#13-post-searchtext). Resumo abaixo.

### 8.1 Campos

| Campo | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `query` | string (min 1) | — | **Obrigatório.** Texto a vetorizar |
| `queries` | `Record<string,string>` | — | Texto por dimensão |
| `empty_vectors` | `query` \| `ignore` | `query` | Dimensões sem texto em `queries`: `query` usa o texto de `query`; `ignore` tira da busca e redistribui o peso entre as preenchidas |
| `weights` | `Record<string,number>` | preset ou iguais | Pesos manuais por dimensão (+ `bm25` se híbrido). Prevalece sobre `weight_preset` |
| `weight_preset` | `escopo` \| `publico_alvo` \| `equilibrado` | — | Pesos prontos por objetivo de busca |
| `search_focus` | `produto` \| `servico` \| `mista` | `mista` | Zera o vetor oposto e redistribui o peso conforme o preset |
| `filter` | object | — | Filtro positivo (allowlist) |
| `filter_not` | object | — | Exclusão (allowlist) |
| `bm25_query` | string | = `query` | Termos sparse |
| `exact_terms` | string \| string[] | — | Termos que **devem** entrar no BM25 |
| `bm25` | boolean | true se configurado | `false` desliga BM25 |
| `limit_per_vector` | int 1…200 | 50 | Candidatos por vetor |
| `final_limit` | int 1…100 | 20 | Resultados finais |
| `rerank` | boolean | false | Reordena top do pool com LLM |
| `query_text` | string | = `query` | Texto usado no rerank |
| `embed_dimensions` | int | env | Dimensões do embedding |
| `debug` | boolean | false | Metadados de debug |

Valores de filtro: `string | number | boolean | array` desses tipos.  
Campos objeto também aceitam **string JSON** (compat n8n).

### 8.2 Filtros allowlist (defaults)

**Keyword** (`payload_keys`):

`modelo_negocio`, `cidade`, `uf`, `nome_empresa`, `cnpj`

**Full-text** (`payload_keys_full_text`):

`descricao`, `endereco`, `publico`, `site`, `email`, `certificacoes`

Confirme sempre via `GET /config` — o ambiente pode diferir.

### 8.3 Exemplos

**Busca simples**

```bash
curl -sS -X POST "$BASE/search/text" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"energia solar","final_limit":5}'
```

**Com filtro UF + exclusão**

```json
{
  "query": "fornecedor de EPI",
  "filter": { "uf": ["SP", "RJ"] },
  "filter_not": { "descricao": "combustível" },
  "final_limit": 10
}
```

**Com rerank (maior latência)**

```json
{
  "query": "software de gestão hospitalar",
  "rerank": true,
  "final_limit": 8
}
```

**Com pré-configuração e foco (recomendado)**

```json
{
  "query": "impermeabilização de lajes para condomínios residenciais",
  "weight_preset": "publico_alvo",
  "search_focus": "servico",
  "final_limit": 10
}
```

### 8.4 Pré-configurações e foco

| `weight_preset` | produto | servico | descricao | publico | cliente |
|-----------------|---------|---------|-----------|---------|---------|
| `escopo` | 0,30 | 0,30 | 0,30 | 0,05 | 0,05 |
| `equilibrado` | 0,25 | 0,25 | 0,25 | 0,125 | 0,125 |
| `publico_alvo` | 0,20 | 0,20 | 0,20 | 0,20 | 0,20 |

Com BM25 ativo, esses valores são multiplicados por 0,8 e `bm25` recebe 0,20.

`search_focus: "produto"` zera `servico`; `"servico"` zera `produto`. O peso zerado vai para a dimensão em foco (`escopo` ou sem preset), é dividido entre as dimensões restantes (`equilibrado`) ou entre `publico` e `cliente` (`publico_alvo`).

Precedência: `weights` explícito > `weight_preset` > pesos iguais. O foco é aplicado por cima e o BM25 por último. A resposta informa o resultado em `weights_used` e a origem em `weights_source`.

Explicação didática e tabela de todas as combinações: [Guia §5](./GUIA.md#5-pré-configurações-e-foco-da-busca).

### 8.5 Semântica de ranking (alto nível)

1. Resolução de pesos (preset/foco/manual + BM25).
2. Embeddings OpenAI por dimensão (`text-embedding-3-small`).
3. Dual-path RRF no Qdrant (BM25-first + Dense-first).
4. Fusão → top `final_limit`.
5. Opcional: LLM rerank no pool.

Detalhes de pesos/boosts: `GET /config` → `weight_presets`, `search_focus`, `dual_path`, `bm25`.

---

## 9. MCP Streamable HTTP

| Item | Valor |
|------|-------|
| Endpoint | `/mcp` |
| Métodos | `POST` (JSON-RPC), `GET` (SSE/stream da sessão), `DELETE` (encerra sessão) |
| Protocolo | [MCP](https://modelcontextprotocol.io) Streamable HTTP |
| Server name | `busca-fornecedor` |
| Auth | Mesma de REST (`Authorization` / `X-Api-Key`) |
| Sessão | Header `mcp-session-id` após `initialize` |

### 9.1 Ciclo de vida

1. `POST /mcp` com body `initialize` (sem session id) → servidor cria sessão.  
2. Resposta inclui session id → cliente envia `mcp-session-id` nas próximas calls.  
3. `tools/list` / `tools/call` via POST.  
4. `DELETE /mcp` com session id encerra.

Erros de auth MCP usam envelope JSON-RPC:

```json
{
  "jsonrpc": "2.0",
  "error": { "code": -32001, "message": "Informe Authorization: Bearer …" },
  "id": null
}
```

### 9.2 Paridade REST ↔ MCP

| Tool MCP | REST |
|----------|------|
| `get_config` | `GET /config` |
| `search_text` | `POST /search/text` |
| `list_conversations` | `GET /conversations` |
| `get_conversation` | `GET /conversations/:id` |
| `delete_conversation` | `DELETE /conversations/:id` |

Toda tool de busca passa por `assertCanSearch` + `executeSearchByText`.

---

## 10. Tools MCP

> Fichas completas de input/output: [ENDPOINTS.md §14](./ENDPOINTS.md#14-mcp--postgetdelete-mcp).

### 10.1 `get_config`

- **Read-only:** sim  
- **Input:** `{}`  
- **Output:** JSON text do mesmo objeto de `GET /config`

### 10.2 `search_text`

- **Read-only:** sim (efeito colateral: telemetria async)  
- **Input:** idêntico ao body de `POST /search/text`, inclusive `weight_preset` e `search_focus`  
- **Output:** JSON text do payload de busca (com `weights_used`, `weights_source`), ou erro `{ error, status, code, search_id }`

### 10.3 `list_conversations`

| Arg | Tipo | Default |
|-----|------|---------|
| `limit` | int 1…100 | 30 |
| `offset` | int ≥0 | 0 |

Requer `userId`. Output = `{ items, total }`.

### 10.4 `get_conversation`

| Arg | Tipo |
|-----|------|
| `id` | UUID |

Output = conversa + `messages[]`.

### 10.5 `delete_conversation`

| Arg | Tipo |
|-----|------|
| `id` | UUID |

**Destructive:** sim. Output = `{ ok: true, id }`.

---

## 11. Contrato de exibição (UI / Adaptive Cards)

Não envie o `payload` bruto do Qdrant para o usuário final. Use o mapper de produto:

**Módulo:** `src/search/resultDisplay.js` → `mapResultsForDisplay(results)`

| Campo | Uso sugerido no card |
|-------|----------------------|
| `posicao` | Ordem / índice |
| `nome_empresa` | Título |
| `local` | `UF · Cidade` |
| `modelo_negocio` | FactSet / badge |
| `descricao` | Texto ≤ 400 chars |
| `site` / `site_label` | Action OpenUrl |
| `perfil_url` | `https://buscafornecedor.com.br/perfil/{cnpj_basico}` |
| `site_md` / `perfil_md` | Markdown pronto (chat texto) |

**Recomendação Teams:** 5–10 resultados; Adaptive Card por fornecedor; rodapé “Gerado por IA” + action **Report** com `search_id` + `posicao`.

---

## 12. X-Ray (harness QA)

UI HTML + endpoints sob `/search/xray*` para validação interna.

| Flag | Comportamento |
|------|----------------|
| Produção | Default **off** |
| `XRAY_ENABLED=1` | Liga |
| `XRAY_ENABLED=0` | Força off |

**Não use X-Ray como API de produção** para o Agent-Proxy. Prefira REST/MCP públicos.

---

## 13. Arquitetura interna (para integradores)

```
src/
  app.js                 # Express factory: helmet, CORS, health, routers, MCP
  routes/index.js        # REST de negócio
  mcp/                   # Streamable HTTP + tools Zod
  searchService.js       # Núcleo de busca
  search/                # fallback, display, bm25 helpers
  schemas/searchText.js  # Contrato REST+MCP
  auth/                  # resolveAuth, registerBuyer, api keys
  telemetry/             # enqueue async consultas/aparições
  comms/                 # fila recebe-consulta → notificacao-clientes
  db/                    # Supabase admin + pg pool + repos
  xray/                  # harness QA (opcional)
```

**O que o Agent-Proxy NÃO deve chamar:**

- Qdrant / OpenAI / Supabase service role diretamente  
- `/search/xray*` em produção  
- Endpoints internos de notificação (n8n + notificacao-clientes)

---

## 14. Guia rápido Agent-Proxy

| Momento Teams | Ação no proxy | Chamada API |
|---------------|---------------|-------------|
| Install / FRE | Mensagem local | opcional `GET /config` |
| “Olá” / “Ajuda” | Resposta local | — |
| Busca | Typing → HTTP | `POST /search/text` |
| Latência > 3s | Manter typing | — |
| Resultados | Adaptive Cards | mapper display |
| Report IA | Log / webhook | correlacionar `search_id` |
| Health Azure | Probe | `GET /health` |

Variáveis sugeridas no Azure Key Vault:

- `BUSCA_API_BASE_URL`
- `BUSCA_API_KEY` (serviço)
- Bot App ID / Client Secret (Entra)

Timeout HTTP do proxy ≥ latência típica de busca; `rerank: true` só quando aceitável estourar 3s (typing já cobre UX).

---

## 15. OpenAPI-like cheat sheet

```
GET    /health
GET    /config
GET    /docs

POST   /auth/register-buyer
POST   /auth/login-buyer
POST   /auth/refresh
GET    /auth/me
POST   /auth/api-keys
POST   /auth/api-keys/revoke
GET    /auth/consultas/:searchId
PATCH  /auth/consultas/:searchId/qualidade
GET    /auth/aparicoes/:cnpj

GET    /conversations
GET    /conversations/:id
DELETE /conversations/:id

POST   /search/text

POST   /mcp
GET    /mcp
DELETE /mcp

# Opcional (dev/QA)
GET    /search/xray
…
```

### Auth header

```
Authorization: Bearer <sk_bf_… | jwt>
```

### Search minimal

```json
{ "query": "string", "final_limit": 5 }
```

### Search com pesos automáticos

```json
{ "query": "string", "weight_preset": "escopo|publico_alvo|equilibrado", "search_focus": "produto|servico|mista" }
```

### MCP tools

```
get_config | search_text | list_conversations | get_conversation | delete_conversation
```

---

## Changelog desta doc

| Data | Nota |
|------|------|
| 2026-10-06 | `empty_vectors` (`query` \| `ignore`) para dimensões sem texto em `queries` |
| 2026-10-06 | `weight_preset` / `search_focus`, novos campos de resposta e de `/config`, `/auth/refresh` e `PATCH …/qualidade` nas tabelas, página `GET /docs` e Guia de uso |
| 2026-08-12 | Referência inicial alinhada a `src/` (REST + MCP + auth + display) |

**Manutenção:** ao adicionar endpoint/tool, atualizar este arquivo **e** o Document Hub Notion (skill `notion-sync`). Código em `src/` prevalece em caso de divergência.
