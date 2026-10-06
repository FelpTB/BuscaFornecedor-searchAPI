# Catálogo de Endpoints — BuscaFornecedor API

**Versão:** 1.0.0  
**Base:** `https://<serviço>.up.railway.app` (prod) · `http://127.0.0.1:3000` (local)  
**Formato:** JSON UTF-8 · `Content-Type: application/json`  
**Fonte de código:** `src/routes/index.js`, `src/app.js`, `src/mcp/`  

Documentos irmãos: [GUIA.md](./GUIA.md) (conceitos e primeiros passos) · [REFERENCE.md](./REFERENCE.md) (auth, erros, limites, Agent-Proxy).

Para cada endpoint: **o que faz**, **como funciona**, **input**, **output**, **erros**.

> Novo na API? Comece pelo [Guia de uso](./GUIA.md). Esta página é o catálogo de consulta.

---

## Índice

| Método | Path | Auth | Seção |
|--------|------|------|-------|
| `GET` | `/health` | Pública | [§1](#1-get-health) |
| `GET` | `/config` | Opcional | [§2](#2-get-config) |
| `POST` | `/auth/register-buyer` | Pública + rate limit | [§3](#3-post-authregister-buyer) |
| `POST` | `/auth/login-buyer` | Pública + rate limit | [§4](#4-post-authlogin-buyer) |
| `POST` | `/auth/refresh` | Pública + rate limit | [§4.1](#41-post-authrefresh) |
| `GET` | `/auth/me` | Opcional | [§5](#5-get-authme) |
| `POST` | `/auth/api-keys` | Autenticado | [§6](#6-post-authapi-keys) |
| `POST` | `/auth/api-keys/revoke` | Autenticado | [§7](#7-post-authapi-keysrevoke) |
| `GET` | `/auth/consultas/:searchId` | Autenticado (`userId`) | [§8](#8-get-authconsultassearchid) |
| `PATCH` | `/auth/consultas/:searchId/qualidade` | Autenticado (`userId`) | [§8.1](#81-patch-authconsultassearchidqualidade) |
| `GET` | `/auth/aparicoes/:cnpj` | Autenticado | [§9](#9-get-authaparicoescnpj) |
| `GET` | `/conversations` | Autenticado (`userId`) | [§10](#10-get-conversations) |
| `GET` | `/conversations/:id` | Autenticado (`userId`) | [§11](#11-get-conversationsid) |
| `DELETE` | `/conversations/:id` | Autenticado (`userId`) | [§12](#12-delete-conversationsid) |
| `POST` | `/search/text` | `assertCanSearch` | [§13](#13-post-searchtext) |
| `POST` | `/mcp` | Conforme `AUTH_MODE` | [§14](#14-mcp--postgetdelete-mcp) |
| `GET` | `/mcp` | Idem | [§14](#14-mcp--postgetdelete-mcp) |
| `DELETE` | `/mcp` | Idem | [§14](#14-mcp--postgetdelete-mcp) |
| `GET` | `/docs`, `/docs/:slug`, `/docs/:slug.md` | Pública | [§17](#17-get-docs) |

---

## Convenções comuns

### Headers de request

| Header | Obrigatório | Descrição |
|--------|-------------|-----------|
| `Content-Type` | Em POST com body | `application/json` |
| `Authorization` | Quando auth exigida | `Bearer <sk_bf_…\|jwt>` |
| `X-Api-Key` | Alternativa | Plaintext da API key |
| `X-Request-Id` | Não | Correlação; se omitido, a API gera |

### Headers de response

| Header | Quando | Descrição |
|--------|--------|-----------|
| `X-Request-Id` | Sempre | Eco / UUID gerado |
| `X-Search-Id` | `POST /search/text` | UUID da busca |

### Envelope de erro

```json
{
  "error": "Mensagem legível",
  "code": "BAD_REQUEST",
  "details": {},
  "request_id": "uuid"
}
```

---

## 1. `GET /health`

### O que faz

Verifica se o processo está vivo e devolve metadados de serviço (paths, modos de auth, uptime). Não consulta Qdrant/OpenAI/Supabase.

### Como funciona

1. Express responde imediatamente com JSON estático + `process.uptime()`.
2. Não passa por `assertCanSearch`.
3. Ideal para healthcheck (Railway, Azure App Service, load balancer).

### Input

- **Path / query / body:** nenhum.
- **Auth:** não requerida.

### Output — `200 OK`

```json
{
  "status": "ok",
  "service": "busca-fornecedor-api-mcp",
  "version": "1.0.0",
  "mcp": "/mcp",
  "search": "/search/text",
  "config": "/config",
  "docs": "/docs",
  "search_xray": "/search/xray",
  "xray_enabled": true,
  "auth_mode": "api_key",
  "auth_modes": ["api_key", "supabase_jwt"],
  "require_comprador": false,
  "require_acesso_agente": false,
  "uptime": 3842.15
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `status` | string | Sempre `"ok"` se o processo respondeu |
| `service` | string | Nome lógico do serviço |
| `version` | string | Versão da API |
| `mcp` / `search` / `config` / `docs` | string | Paths canônicos |
| `search_xray` | string \| null | Path do harness ou `null` se desligado |
| `xray_enabled` | boolean | Flag `XRAY_ENABLED` |
| `auth_mode` | string | Modo “principal” (compat) |
| `auth_modes` | string[] | Lista efetiva de `AUTH_MODE` |
| `require_comprador` | boolean | Gate de perfil/cota |
| `require_acesso_agente` | boolean | Se o modo de busca com agente exige allowlist (`acesso_agente`) |
| `uptime` | number | Segundos desde o boot |

### Erros

Praticamente nenhum (se não responder, o processo está down).

---

## 2. `GET /config`

### O que faz

Expõe o **contrato operacional** da busca: dimensões, nomes de vetores, filtros allowlist, BM25, dual-path, limites, status de auth/Supabase/notificação e lista de tools MCP.

### Como funciona

1. Middleware de auth roda (anônimo permitido).
2. `getPublicConfig()` lê env + feature flags e monta o JSON.
3. Cliente deve **cachear** no startup (valores mudam só com redeploy/env).

### Input

- **Path / query / body:** nenhum.
- **Auth:** opcional.

### Output — `200 OK`

```json
{
  "architecture": "dual-path-rrf-v5",
  "dimension_keys": ["produto", "servico", "descricao", "publico", "cliente"],
  "payload_keys": ["modelo_negocio", "cidade", "uf", "nome_empresa", "cnpj"],
  "payload_keys_full_text": ["descricao", "endereco", "publico", "site", "email", "certificacoes"],
  "vector_names": {
    "produto": "v_produto",
    "servico": "v_servico",
    "descricao": "v_descricao",
    "publico": "v_publico",
    "cliente": "v_cliente"
  },
  "filter_not_supported": true,
  "full_text_filter_supported": true,
  "weight_presets": {
    "values": ["escopo", "publico_alvo", "equilibrado"],
    "dense_weights": {
      "escopo": { "produto": 0.3, "servico": 0.3, "descricao": 0.3, "publico": 0.05, "cliente": 0.05 },
      "publico_alvo": { "produto": 0.2, "servico": 0.2, "descricao": 0.2, "publico": 0.2, "cliente": 0.2 },
      "equilibrado": { "produto": 0.25, "servico": 0.25, "descricao": 0.25, "publico": 0.125, "cliente": 0.125 }
    },
    "precedence": "weights explícito > weight_preset > pesos iguais",
    "bm25": "Com BM25 ativo, bm25 recebe 0.20 e os pesos densos são reescalados para 0.80"
  },
  "search_focus": {
    "values": ["produto", "servico", "mista"],
    "behavior": "produto zera o peso de servico, servico zera o de produto; mista mantém ambos. Destino do peso zerado por preset:",
    "redistribution": {
      "escopo": "dimensão em foco",
      "equilibrado": "dividido igualmente entre todas as dimensões densas restantes",
      "publico_alvo": "dividido igualmente entre publico e cliente",
      "sem_preset": "dimensão em foco (pesos explícitos ou padrão)"
    }
  },
  "empty_vectors": {
    "values": ["query", "ignore"],
    "default": "query",
    "behavior": {
      "query": "dimensões sem texto em queries usam o texto de query",
      "ignore": "busca só nas dimensões preenchidas em queries; o peso das vazias é redistribuído proporcionalmente entre elas"
    }
  },
  "bm25": {
    "vector_name": "bm25_complete_profile",
    "payload_keys": null,
    "rrf_k": 60
  },
  "dual_path": {
    "paths": ["A (BM25-First)", "B (Dense-First + BM25 Modifier)"],
    "rrf_k": 10,
    "path_top_n": 20,
    "bm25_modifier": { "boost": 1.0, "absent_factor": 0.85 }
  },
  "llm_rerank": {
    "enabled": true,
    "model": "gpt-4o-mini",
    "pool_size": 20,
    "usage": "Envie rerank=1 como query param ou rerank: true no body…"
  },
  "limits": {
    "limit_per_vector_max": 200,
    "final_limit_max": 100,
    "limit_per_vector_default": 50,
    "final_limit_default": 20
  },
  "auth": {
    "mode": "api_key",
    "modes": ["api_key", "supabase_jwt"],
    "required": true,
    "require_comprador": false,
    "require_acesso_agente": false,
    "headers": ["Authorization: Bearer <jwt|sk_bf_…>", "X-Api-Key"],
    "register": "POST /auth/register-buyer",
    "login": "POST /auth/login-buyer",
    "profile": "GET /auth/me",
    "api_keys": "POST /auth/api-keys"
  },
  "supabase": {
    "configured": true,
    "pg_pool": true,
    "telemetry_mode": "inline"
  },
  "notificacao": {
    "mode": "on",
    "configured": true,
    "base_url": "https://…",
    "endpoint": "/v1/interno/orquestracao/recebe-consulta"
  },
  "mcp": {
    "endpoint": "/mcp",
    "tools": [
      "get_config",
      "search_text",
      "list_conversations",
      "get_conversation",
      "delete_conversation"
    ],
    "auth": true
  }
}
```

Principais blocos:

| Campo | Para que serve |
|-------|----------------|
| `dimension_keys` | Dimensões aceitas em `queries` e `weights` |
| `payload_keys` / `payload_keys_full_text` | Chaves permitidas em `filter` e `filter_not` (exatas / texto) |
| `weight_presets` | Valores de `weight_preset`, pesos de cada um e regra de precedência |
| `search_focus` | Valores de `search_focus` e para onde vai o peso zerado em cada preset |
| `empty_vectors` | O que acontece com dimensões sem texto em `queries` (padrão e opções) |
| `bm25` / `dual_path` | Configuração da busca por palavra-chave e da fusão híbrida |
| `llm_rerank` | Se o rerank está disponível, modelo e tamanho do pool |
| `limits` | Padrões e máximos de `final_limit` e `limit_per_vector` |
| `auth` | Modos de autenticação, headers aceitos e rotas de cadastro/login |
| `mcp` | Endpoint MCP e tools disponíveis |

### Erros

Raros; em falha interna → `500`.

---

## 3. `POST /auth/register-buyer`

### O que faz

Onboarding: cria usuário no Supabase Auth, perfil `usuario_comprador` e emite a **primeira API key** (plaintext devolvido **uma vez**).

### Como funciona

1. Rate limit: 10 tentativas / 15 min / IP.
2. Valida `email` e `nome`.
3. `auth.admin.createUser` (e-mail confirmado).
4. Garante linha em `usuario_comprador`.
5. Gera `sk_bf_…`, persiste só `key_hash` + `key_prefix`.
6. Se `password` omitido, gera senha temporária e devolve em `temporary_password`.

### Input — body JSON

```json
{
  "email": "comprador@empresa.com",
  "nome": "Maria Silva",
  "telefone": "+5511999999999",
  "empresa_nome": "Empresa LTDA",
  "password": "senhaSegura8+",
  "fonte": "AgentProxy",
  "key_name": "teams-bot"
}
```

| Campo | Tipo | Obrigatório | Default | Regras |
|-------|------|-------------|---------|--------|
| `email` | string | sim | — | Deve conter `@`; normalizado lowercase |
| `nome` | string | sim | — | Não vazio após trim |
| `telefone` | string | não | — | Livre |
| `empresa_nome` | string | não | — | Livre |
| `password` | string | não | gerada | Se informada, ≥ 8 chars recomendado |
| `fonte` | string | não | `"API"` | Origem do cadastro |
| `key_name` | string | não | `"api"` | Nome da key |

### Output — `201 Created`

```json
{
  "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  "email": "comprador@empresa.com",
  "comprador": {
    "nome": "Maria Silva",
    "tier_busca": "normal",
    "limite_buscas": 50,
    "buscas_realizadas": 0
  },
  "api_key": {
    "id": "uuid",
    "name": "teams-bot",
    "key_prefix": "sk_bf_ab",
    "key": "sk_bf_abcdefghijklmnopqrstuvwxyz",
    "warning": "Guarde esta chave agora. Ela não será exibida novamente."
  }
}
```

Se senha foi gerada pelo servidor, campos extras:

```json
{
  "temporary_password": "Tmp!…",
  "password_note": "Senha temporária gerada — guarde para login futuro…"
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `user_id` | uuid | `auth.users.id` |
| `email` | string | E-mail cadastrado |
| `comprador.*` | object | Tier e cota |
| `api_key.key` | string | **Plaintext — único momento** |
| `api_key.key_prefix` | string | Prefixo para logs/revoke |

### Erros

| HTTP | Situação |
|------|----------|
| `400` | E-mail/nome inválidos; e-mail já cadastrado (`hint: login-buyer`) |
| `403` | Limite de API keys ativas (`MAX_ACTIVE_API_KEYS`) |
| `502` | Falha ao criar user no Auth |
| `503` | Supabase não configurado |
| `429` | Rate limit |

---

## 4. `POST /auth/login-buyer`

### O que faz

Autentica comprador existente (email + senha). Opcionalmente emite **nova** API key e/ou devolve JWT (`access_token`).

### Como funciona

1. Rate limit: 10 / 15 min / IP.
2. `signInWithPassword` via client anon (ou fallback).
3. Garante perfil comprador.
4. Se `LOGIN_MINT_API_KEY` ativo → gera nova key (respeitando cap).
5. Se mint desligado (default em produção se env omitido) → devolve `access_token` sem nova key.

### Input — body JSON

```json
{
  "email": "comprador@empresa.com",
  "password": "senhaSegura8+",
  "fonte": "AgentProxy",
  "key_name": "teams-login"
}
```

| Campo | Tipo | Obrigatório | Default |
|-------|------|-------------|---------|
| `email` | string | sim | — |
| `password` | string | sim (≥ 6) | — |
| `fonte` | string | não | `"API"` |
| `key_name` | string | não | `"api-login"` |

### Output — `200 OK` (com mint de key)

```json
{
  "user_id": "uuid",
  "email": "comprador@empresa.com",
  "comprador": {
    "nome": "Maria Silva",
    "tier_busca": "normal",
    "limite_buscas": 50,
    "buscas_realizadas": 3
  },
  "api_key": {
    "id": "uuid",
    "name": "teams-login",
    "key_prefix": "sk_bf_xy",
    "key": "sk_bf_…plaintext…",
    "warning": "Guarde esta chave agora. Ela não será exibida novamente."
  },
  "access_token": "eyJhbGciOi…",
  "note": "API key emitida para conta existente. O JWT (access_token) também autentica se AUTH_MODE incluir supabase_jwt."
}
```

### Output — `200 OK` (sem mint: `LOGIN_MINT_API_KEY=0`)

```json
{
  "user_id": "uuid",
  "email": "comprador@empresa.com",
  "comprador": {
    "nome": "Maria Silva",
    "tier_busca": "normal",
    "limite_buscas": 50,
    "buscas_realizadas": 3
  },
  "api_key": null,
  "access_token": "eyJhbGciOi…",
  "note": "Login OK sem nova API key (LOGIN_MINT_API_KEY=0). Use access_token (JWT) ou POST /auth/api-keys autenticado."
}
```

### Erros

| HTTP | Situação |
|------|----------|
| `400` | E-mail/senha ausentes ou inválidos |
| `401` | Credenciais incorretas |
| `403` | Sem perfil comprador / cap de keys |
| `503` | Supabase / anon key ausente |
| `429` | Rate limit |

---

## 4.1 `POST /auth/refresh`

Renova o JWT do comprador com o `refresh_token` devolvido em `login-buyer`. Não emite API key.

```json
{ "refresh_token": "…" }
```

Resposta `200`: `{ "user_id", "access_token", "refresh_token", "expires_in", "expires_at" }`.  
`401` se o refresh expirou — o cliente deve pedir login de novo.

---

## 5. `GET /auth/me`

### O que faz

Responde “quem sou eu” com base no Bearer/`X-Api-Key` atual. Se autenticado com `userId`, inclui perfil completo e lista de API keys (sem plaintext).

### Como funciona

1. `resolveAuthContext` no middleware.
2. Sem `userId` → `{ authenticated: false, auth: … }`.
3. Com `userId` → `getProfile` (comprador + keys).

### Input

- **Body / query:** nenhum.
- **Auth:** opcional (sem credencial → anônimo).

### Output — anônimo — `200 OK`

```json
{
  "authenticated": false,
  "auth": {
    "authenticated": false,
    "userId": null,
    "provider": "anonymous",
    "keyPrefix": null,
    "roles": [],
    "comprador": null
  }
}
```

### Output — autenticado — `200 OK`

```json
{
  "authenticated": true,
  "auth": {
    "authenticated": true,
    "userId": "uuid",
    "provider": "api_key",
    "keyPrefix": "sk_bf_ab",
    "roles": ["comprador"],
    "comprador": {
      "nome": "Maria Silva",
      "tierBusca": "normal",
      "limiteBuscas": 50,
      "buscasRealizadas": 3,
      "acessoAgente": true
    }
  },
  "profile": {
    "user_id": "uuid",
    "comprador": {
      "nome": "Maria Silva",
      "telefone": "+55…",
      "empresa_nome": "Empresa LTDA",
      "tier_busca": "normal",
      "limite_buscas": 50,
      "buscas_realizadas": 3,
      "fonte": "AgentProxy",
      "acesso_agente": true
    },
    "api_keys": [
      {
        "id": "uuid",
        "name": "teams-bot",
        "key_prefix": "sk_bf_ab",
        "active": true,
        "created_at": "2026-08-01T12:00:00.000Z",
        "last_used_at": "2026-08-12T15:00:00.000Z",
        "revoked_at": null
      }
    ]
  }
}
```

> Nota: em `auth.comprador` os campos usam camelCase (`tierBusca`, `acessoAgente`); em `profile.comprador` usam snake_case (`tier_busca`, `acesso_agente`). `acesso_agente` é a allowlist do modo de busca com agente.

### Erros

| HTTP | Situação |
|------|----------|
| `401` | Credencial enviada porém inválida (middleware) |
| `500` | Falha ao ler perfil |

---

## 6. `POST /auth/api-keys`

### O que faz

Emite uma **nova** API key para o usuário já autenticado (não cria usuário).

### Como funciona

1. Exige `req.auth.userId`.
2. Verifica perfil comprador.
3. Respeita `MAX_ACTIVE_API_KEYS` (default 5).
4. Devolve plaintext uma vez.

### Input — body JSON

```json
{
  "name": "agent-proxy-prod"
}
```

| Campo | Tipo | Obrigatório | Default |
|-------|------|-------------|---------|
| `name` | string | não | `"agent"` |

### Output — `201 Created`

```json
{
  "id": "uuid",
  "name": "agent-proxy-prod",
  "key_prefix": "sk_bf_xy",
  "key": "sk_bf_…plaintext…",
  "warning": "Guarde esta chave agora. Ela não será exibida novamente."
}
```

### Erros

| HTTP | Situação |
|------|----------|
| `401` | Sem autenticação / sem `userId` |
| `403` | Sem comprador ou cap de keys |

---

## 7. `POST /auth/api-keys/revoke`

### O que faz

Revoga uma API key ativa do usuário (por `key_prefix`). Invalida cache de auth dessa key.

### Como funciona

1. Exige `userId`.
2. Localiza key pelo prefixo pertencente ao usuário.
3. Marca revogada / inativa.

### Input — body JSON

```json
{
  "key_prefix": "sk_bf_xy"
}
```

| Campo | Tipo | Obrigatório |
|-------|------|-------------|
| `key_prefix` | string | sim |

### Output — `200 OK`

```json
{
  "revoked": true,
  "key_prefix": "sk_bf_xy",
  "id": "uuid"
}
```

### Erros

| HTTP | Situação |
|------|----------|
| `400` | `key_prefix` ausente ou chave não encontrada / já revogada |
| `401` | Não autenticado |

---

## 8. `GET /auth/consultas/:searchId`

### O que faz

Lê a linha de telemetria `busca_fornecedor.consultas` gerada de forma **assíncrona** após uma busca. Serve como probe de persistência / debug.

### Como funciona

1. Exige `userId`.
2. Busca por `id = searchId` (mesmo UUID de `search_id` / `X-Search-Id`).
3. Só devolve se `row.comprador === userId` (senão `403`).
4. Pode retornar `404` se a telemetria ainda não gravou (race com async).

### Input

| Parte | Nome | Tipo | Obrigatório |
|-------|------|------|-------------|
| path | `searchId` | uuid string | sim |
| body | — | — | — |
| auth | Bearer / X-Api-Key | — | sim (`userId`) |

### Output — `200 OK`

Shape = linha da tabela `consultas` (campos selecionados):

```json
{
  "id": "uuid-search-id",
  "comprador": "uuid-user",
  "status": "concluida",
  "origem": "rest",
  "created_at": "2026-08-12T17:00:00.000Z",
  "parametros": {},
  "resultados": [],
  "v_produto": null,
  "v_servico": null,
  "v_descricao": null,
  "v_publico": null,
  "v_cliente": null,
  "bm_25": null,
  "uf": null,
  "municipio": null,
  "modelo_negocio": null
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | = `search_id` da busca |
| `comprador` | uuid | Dono |
| `status` | string | Ex.: `concluida` |
| `origem` | string | Ex.: `rest` / `mcp` |
| `parametros` | object | Params normalizados da busca |
| `resultados` | array | Snapshot dos resultados persistidos |

### Erros

| HTTP | Situação |
|------|----------|
| `401` | Sem `userId` |
| `403` | Consulta de outro comprador |
| `404` | Ainda não gravada ou inexistente |

---

## 8.1 `PATCH /auth/consultas/:searchId/qualidade`

### O que faz

Registra a avaliação do comprador sobre o resultado de uma busca. Usado para medir e calibrar a qualidade da busca.

### Como funciona

1. Exige `userId`.
2. Valida `qualidade` contra a lista permitida.
3. Atualiza `busca_fornecedor.consultas.qualidade` **somente** se a consulta pertence ao usuário.
4. Se a consulta ainda não foi gravada (telemetria assíncrona) ou é de outro comprador → `404`.

### Input

| Parte | Nome | Tipo | Obrigatório | Valores |
|-------|------|------|-------------|---------|
| path | `searchId` | uuid | sim | `search_id` devolvido pela busca |
| body | `qualidade` | string | sim | `Ótimo`, `Bom`, `Ruim`, `Péssimo` |

```json
{ "qualidade": "Bom" }
```

### Output — `200 OK`

```json
{ "id": "uuid-search-id", "qualidade": "Bom" }
```

### Erros

| HTTP | Situação |
|------|----------|
| `400` | `qualidade` ausente ou fora da lista |
| `401` | Sem `userId` |
| `404` | Consulta inexistente, ainda não gravada ou de outro comprador |
| `503` | Persistência não configurada |

---

## 9. `GET /auth/aparicoes/:cnpj`

### O que faz

Retorna o agregado live de aparições do fornecedor (`contador_aparicoes`), usando os **8 dígitos básicos** do CNPJ.

### Como funciona

1. Exige autenticação (`authenticated`).
2. Normaliza CNPJ → basico 8 dígitos.
3. Lê `n_aparicoes` / `limite_aparicoes`.
4. Se não houver linha → `{ cnpj, total: 0 }`.

### Input

| Parte | Nome | Tipo | Obrigatório |
|-------|------|------|-------------|
| path | `cnpj` | string (com ou sem máscara) | sim |
| auth | Bearer / X-Api-Key | — | sim |

Exemplos de path: `/auth/aparicoes/12345678000199` ou `/auth/aparicoes/12345678`.

### Output — `200 OK`

```json
{
  "cnpj": "12345678",
  "total": 42,
  "limite": 100,
  "updated_at": "2026-08-12T10:00:00.000Z"
}
```

Sem registro:

```json
{
  "cnpj": "12345678",
  "total": 0
}
```

### Erros

| HTTP | Situação |
|------|----------|
| `401` | Não autenticado |
| `500` | Falha Supabase |

---

## 10. `GET /conversations`

### O que faz

Lista conversas persistidas do usuário autenticado (histórico do agente / X-Ray), ordenadas por `updated_at` desc.

### Como funciona

1. Exige `userId`.
2. Paginação `limit` (1–100, default 30) e `offset` (≥ 0).
3. Se Supabase/pool ausente → `{ items: [], total: 0, note: "supabase_not_configured" }`.

### Input — query

| Param | Tipo | Default | Limite |
|-------|------|---------|--------|
| `limit` | number | `30` | 1…100 |
| `offset` | number | `0` | ≥ 0 |

**Auth:** Bearer / X-Api-Key com `userId`.

### Output — `200 OK`

```json
{
  "items": [
    {
      "id": "uuid",
      "title": "energia solar em SP",
      "source": "xray",
      "key_prefix": "sk_bf_ab",
      "last_search_id": "uuid",
      "created_at": "2026-08-10T12:00:00.000Z",
      "updated_at": "2026-08-12T12:00:00.000Z"
    }
  ],
  "total": 1
}
```

| Campo item | Tipo | Descrição |
|------------|------|-----------|
| `id` | uuid | ID da conversa (= session) |
| `title` | string \| null | Derivado da 1ª msg do user |
| `source` | string \| null | Origem (ex. xray) |
| `last_search_id` | uuid \| null | Última busca associada |
| `total` | number | Total de conversas do user (não só a página) |

### Erros

| HTTP | Situação |
|------|----------|
| `401` | Sem `userId` |

---

## 11. `GET /conversations/:id`

### O que faz

Retorna uma conversa + mensagens ordenadas por `seq`. Também tenta hidratar a sessão em memória do X-Ray (se aplicável).

### Como funciona

1. Exige `userId` e ownership (`user_id` da row).
2. Carrega mensagens (`role`, `content`, `metadata`, `seq`).
3. `404` se não existir / não pertencer.

### Input

| Parte | Nome | Tipo |
|-------|------|------|
| path | `id` | uuid |
| auth | Bearer | com `userId` |

### Output — `200 OK`

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "api_key_id": "uuid",
  "key_prefix": "sk_bf_ab",
  "title": "energia solar em SP",
  "source": "xray",
  "last_search_id": "uuid",
  "created_at": "2026-08-10T12:00:00.000Z",
  "updated_at": "2026-08-12T12:00:00.000Z",
  "messages": [
    {
      "id": "uuid",
      "role": "user",
      "content": "procure energia solar em SP",
      "metadata": {},
      "seq": 1,
      "created_at": "2026-08-10T12:00:01.000Z"
    },
    {
      "id": "uuid",
      "role": "assistant",
      "content": "Encontrei 5 fornecedores…",
      "metadata": {},
      "seq": 2,
      "created_at": "2026-08-10T12:00:05.000Z"
    }
  ]
}
```

| Campo message | Tipo | Valores |
|---------------|------|---------|
| `role` | string | `user` \| `assistant` \| `tool` |
| `content` | string \| null | Texto |
| `metadata` | object | Metadados livres |
| `seq` | number | Ordem crescente |

### Erros

| HTTP | Situação |
|------|----------|
| `401` | Sem `userId` |
| `404` | Não encontrada |

---

## 12. `DELETE /conversations/:id`

### O que faz

Exclui permanentemente a conversa do usuário (cascade nas mensagens) e esquece sessão em memória do X-Ray.

### Como funciona

1. `DELETE` filtrado por `id` + `user_id`.
2. Retorna `{ ok: true, id }` ou `404`.

### Input

| Parte | Nome | Tipo |
|-------|------|------|
| path | `id` | uuid |
| body | — | — |
| auth | Bearer | com `userId` |

### Output — `200 OK`

```json
{
  "ok": true,
  "id": "uuid"
}
```

### Erros

| HTTP | Situação |
|------|----------|
| `401` | Sem `userId` |
| `404` | Não encontrada |

---

## 13. `POST /search/text`

### O que faz

**Hot path principal:** busca híbrida de fornecedores (embeddings OpenAI → Qdrant dual-path RRF → opcional LLM rerank). Enfileira telemetria/comms **após** montar a resposta (não bloqueia).

### Como funciona

1. Rate limit 120/min (por `keyPrefix` ou IP).
2. `assertCanSearch(auth)` — credencial, scope `search`, opcionalmente comprador + cota.
3. Valida body com Zod (`parseSearchTextBody`). `weight_preset` e `search_focus` aceitam variações de escrita ("Serviço", "Público Alvo", "misto") e são normalizados.
4. Gera `search_id` (UUID).
5. **Resolve os pesos**, nesta ordem:
   1. pesos-base: `weights` explícito → senão `weight_preset` → senão pesos iguais;
   2. aplica `search_focus` (zera produto ou serviço e redistribui o peso conforme o preset);
   3. com `empty_vectors: "ignore"`, zera as dimensões sem texto em `queries` e redistribui o peso delas, proporcionalmente, entre as preenchidas;
   4. ajusta o BM25 (reserva 0,20 se ativo; remove a chave se desligado).
6. Vetoriza com `text-embedding-3-small` os textos de `queries` e, com `empty_vectors: "query"` (padrão), o `query` para as dimensões sem texto próprio.
7. Executa multi-vector search no Qdrant (+ BM25 se configurado), em dois caminhos fundidos por RRF. Dimensões com peso 0 não são consultadas.
8. Opcional: rerank LLM no pool.
9. Responde JSON + header `X-Search-Id`, incluindo `weights_used`.
10. `maybeEnqueueFromSearch` (async) → `consultas` / aparições / `recebe-consulta`. Quando o cliente não envia `weights`, a telemetria grava os pesos efetivos.

### Input — query string

| Param | Tipo | Efeito |
|-------|------|--------|
| `debug=1` | flag | Inclui bloco `debug` |
| `rerank=1` | flag | Ativa rerank (equivalente a body `rerank: true`) |

### Input — body JSON

Mínimo:

```json
{ "query": "locação de andaimes para obras" }
```

Recomendado (pesos automáticos):

```json
{
  "query": "impermeabilização de lajes para condomínios residenciais",
  "weight_preset": "publico_alvo",
  "search_focus": "servico",
  "filter": { "uf": ["SP", "RJ"] },
  "final_limit": 10
}
```

Completo (todos os campos):

```json
{
  "query": "energia solar",
  "queries": {
    "produto": "painel fotovoltaico",
    "servico": "instalação solar"
  },
  "empty_vectors": "query",
  "weights": {
    "produto": 0.3,
    "servico": 0.2,
    "descricao": 0.2,
    "publico": 0.1,
    "cliente": 0.1,
    "bm25": 0.1
  },
  "weight_preset": "equilibrado",
  "search_focus": "mista",
  "filter": { "uf": "SP", "cidade": ["São Paulo", "Campinas"] },
  "filter_not": { "descricao": "combustível" },
  "bm25_query": "energia solar fotovoltaica",
  "exact_terms": ["energia solar"],
  "bm25": true,
  "limit_per_vector": 50,
  "final_limit": 10,
  "rerank": false,
  "query_text": "energia solar",
  "embed_dimensions": 1536,
  "debug": false
}
```

> Neste exemplo completo, `weight_preset` é ignorado porque `weights` foi enviado.

| Campo | Tipo | Obrigatório | Default | Descrição |
|-------|------|-------------|---------|-----------|
| `query` | string (min 1) | **sim** | — | Texto principal a vetorizar |
| `queries` | `Record<string,string>` | não | — | Texto por dimensão |
| `empty_vectors` | `query` \| `ignore` | não | `query` | Dimensões sem texto em `queries`: usam `query` ou ficam de fora da busca |
| `weights` | `Record<string,number>` | não | preset ou iguais | Pesos manuais. Ver regras de soma abaixo |
| `weight_preset` | `escopo` \| `publico_alvo` \| `equilibrado` | não | — | Pesos prontos. Ignorado se `weights` for enviado |
| `search_focus` | `produto` \| `servico` \| `mista` | não | `mista` | Zera o vetor oposto e redistribui o peso dele |
| `filter` | object | não | — | Filtro positivo allowlist |
| `filter_not` | object | não | — | Exclusão allowlist |
| `bm25_query` | string | não | = `query` | Termos do canal sparse |
| `exact_terms` | string \| string[] | não | — | Termos forçados no BM25 |
| `bm25` | boolean | não | on se env OK | `false` desliga BM25 |
| `limit_per_vector` | int | não | `50` | 1…200 |
| `final_limit` | int | não | `20` | 1…100 |
| `rerank` | boolean | não | `false` | Reordena com LLM (↑ latência) |
| `query_text` | string | não | = `query` | Texto do rerank |
| `embed_dimensions` | int | não | env | Dimensões do embedding |
| `debug` | boolean | não | `false` | Metadados de debug |

**Valores de filtro:** `string | number | boolean | array` desses tipos. Objetos também aceitam string JSON (compat n8n).

**Allowlist padrão de `filter` / `filter_not`:**

- Keyword: `modelo_negocio`, `cidade`, `uf`, `nome_empresa`, `cnpj`
- Full-text: `descricao`, `endereco`, `publico`, `site`, `email`, `certificacoes`

Confirme sempre com `GET /config`.

**Semântica dos filtros:** lista ou string com vírgulas = OU (`"SP,RJ"`); várias chaves = E; chaves full-text comparam por palavras contidas; `uf` e `cidade` são normalizados (maiúsculas, sem acento).

#### Pré-configuração (`weight_preset`)

Pesos densos de cada valor (antes do BM25; com BM25 ativo são multiplicados por 0,8 e `bm25` recebe 0,20):

| Valor | produto | servico | descricao | publico | cliente | Quando usar |
|-------|---------|---------|-----------|---------|---------|-------------|
| `escopo` | 0,30 | 0,30 | 0,30 | 0,05 | 0,05 | Prioriza a natureza do produto/serviço |
| `equilibrado` | 0,25 | 0,25 | 0,25 | 0,125 | 0,125 | Meio-termo entre escopo e público |
| `publico_alvo` | 0,20 | 0,20 | 0,20 | 0,20 | 0,20 | Prioriza empresas que atendem o perfil do comprador |

Aliases aceitos: `publico`, `público alvo`, `publico-alvo` → `publico_alvo`; `equilibrada`, `balanceado` → `equilibrado`.

#### Foco (`search_focus`)

| Valor | Efeito |
|-------|--------|
| `produto` | Zera `servico` |
| `servico` | Zera `produto` |
| `mista` | Mantém os dois (igual a omitir) |

Destino do peso zerado:

| Origem dos pesos | Destino |
|------------------|---------|
| `weight_preset: "escopo"` | Dimensão em foco |
| `weight_preset: "equilibrado"` | Dividido igualmente entre as dimensões densas restantes |
| `weight_preset: "publico_alvo"` | Dividido igualmente entre `publico` e `cliente` |
| `weights` explícito ou padrão | Dimensão em foco |

Aliases aceitos: `produtos` → `produto`; `serviço`, `servicos` → `servico`; `misto`, `mixed`, `ambos` → `mista`.

Tabela completa de pesos efetivos por combinação: [Guia §5.3](./GUIA.md#53-como-os-dois-se-combinam).

#### Regras de `weights` manual

| Situação | Comportamento |
|----------|---------------|
| BM25 ativo e sem chave `bm25` | Reserva 0,20 para `bm25` e reescala os pesos enviados para 0,80 (soma enviada pode ser ≠ 1) |
| Com chave `bm25` | Soma de todas as chaves = 1,0 (senão `400`) |
| `bm25: false` | Soma das dimensões = 1,0 (senão `400`) |

### Auth

```http
Authorization: Bearer sk_bf_…
```

Regras (`assertCanSearch`):

- Se `AUTH_MODE ≠ off` → precisa autenticado + `userId`.
- Scope da key deve incluir `search` ou `*`.
- Se `REQUIRE_COMPRADOR=1` → perfil comprador + cota disponível.

### Output — `200 OK`

```json
{
  "search_id": "550e8400-e29b-41d4-a716-446655440000",
  "results": [
    {
      "posicao": 1,
      "id": "qdrant-point-id",
      "score_final": 0.748,
      "score_rrf": 0.181818,
      "scores": {
        "produto": 0,
        "servico": 0.7621,
        "descricao": 0.7223,
        "publico": 0.5289,
        "cliente": 0,
        "bm25": 0.9385
      },
      "paths": ["A#1", "B#1"],
      "in_both": true,
      "payload": {
        "nome_empresa": "Solar Exemplo LTDA",
        "uf": "SP",
        "cidade": "São Paulo",
        "descricao": "Instalação e manutenção de sistemas fotovoltaicos…",
        "site": "https://exemplo.com.br",
        "modelo_negocio": "B2B",
        "cnpj": "12345678000199"
      }
    }
  ],
  "query": "energia solar",
  "mode": "text",
  "embedding_model": "text-embedding-3-small",
  "embedding_dims": 1536,
  "query_texts": {
    "produto": "energia solar",
    "servico": "energia solar",
    "descricao": "energia solar",
    "publico": "energia solar",
    "cliente": "energia solar"
  },
  "weights_used": { "produto": 0, "servico": 0.48, "descricao": 0.24, "publico": 0.04, "cliente": 0.04, "bm25": 0.2 },
  "weights_source": "preset",
  "weight_preset": "escopo",
  "search_focus": "servico",
  "empty_vectors": "query",
  "latency_ms": 842,
  "auth": {
    "authenticated": true,
    "userId": "uuid",
    "provider": "api_key",
    "keyPrefix": "sk_bf_ab",
    "roles": ["comprador"],
    "comprador": {
      "nome": "Maria Silva",
      "tierBusca": "normal",
      "limiteBuscas": 50,
      "buscasRealizadas": 3
    }
  },
  "telemetry_queued": true
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `search_id` | uuid | Correlação logs / Report / consultas |
| `results[].posicao` | int | Ranking 1…N |
| `results[].id` | string | ID do ponto Qdrant |
| `results[].score_final` | number | Score após fusão (/rerank). Comparável só dentro da mesma busca |
| `results[].score_rrf` | number | Score RRF |
| `results[].scores` | object | Similaridade por dimensão/canal (dimensão com peso 0 → 0) |
| `results[].paths` | string[] | Caminho e posição em que apareceu (`A#n` = BM25-first, `B#n` = dense-first) |
| `results[].in_both` | boolean | Presente nos dois paths |
| `results[].payload` | object | Campos do fornecedor no Qdrant (ver abaixo) |
| `query` | string | Query efetiva |
| `mode` | string | `"text"` |
| `embedding_model` | string | Modelo usado |
| `embedding_dims` | number \| undefined | Dimensões |
| `query_texts` | object | Texto efetivo por dimensão (`null` nas dimensões ignoradas por `empty_vectors: "ignore"`) |
| `weights_used` | object | Pesos finais aplicados (com foco e BM25) |
| `weights_source` | `explicit` \| `preset` \| `default` | Origem dos pesos-base |
| `weight_preset` | string \| null | Preset aplicado (normalizado) |
| `search_focus` | string \| null | Foco aplicado (normalizado) |
| `empty_vectors` | `query` \| `ignore` | Tratamento aplicado às dimensões sem texto em `queries` |
| `latency_ms` | number | Tempo total no servidor |
| `rerank` | object? | Só quando o rerank roda: `{ enabled, model, tokens_used, pool_size, query_used }` ou erro |
| `auth` | object | Visão pública da credencial |
| `telemetry_queued` | boolean | Se enfileirou write async |
| `telemetry_reason` | string? | Motivo se **não** enfileirou |

Com `debug=1` / `debug: true`, pode incluir `debug` e `collection`.

**Campos de `payload`** (variam conforme a coleção): `nome_empresa`, `cnpj` (8 dígitos básicos), `modelo_negocio`, `industria`, `uf`, `cidade`, `endereco`, `cobertura_geografica`, `telefone`, `email`, `site`, `linkedin`, `produto`, `servico`, `descricao`, `publico`, `cliente`, `certificacoes`, `premios`, `parcerias`, `estudos_caso`, `created_at`, `updated_at`.

### Erros

| HTTP | Situação | Exemplo de mensagem |
|------|----------|---------------------|
| `400` | Body inválido | `query: Too small: expected string to have >=1 characters` |
| `400` | Preset/foco inválido | `search_focus: Invalid option: expected one of "produto"\|"servico"\|"mista"` |
| `400` | Pesos inválidos | `Campo 'weights' inválido. Chaves esperadas: produto, servico, descricao, publico, cliente, bm25 (soma = 1.0)` |
| `400` | Filtro fora da allowlist | `Chaves de filtro não permitidas: telefone. Permitidas: …` |
| `400` | Foco sem dimensões produto/serviço na coleção | `search_focus requer dimensões de produto e serviço na coleção` |
| `400` | `empty_vectors: "ignore"` sem nenhuma dimensão em `queries` | `empty_vectors=ignore exige ao menos uma dimensão com texto em queries` |
| `400` | `empty_vectors: "ignore"` e o foco (ou `weights`) zera todas as dimensões preenchidas | `Nenhuma dimensão preenchida em queries (produto) tem peso > 0` |
| `401` | Sem auth / sem userId | `Busca requer autenticação…` |
| `403` | Sem scope search; sem comprador; cota esgotada | — |
| `429` | Rate limit | `Too many search requests` |
| `500` / `502` / `503` | OpenAI / Qdrant / config | — |

### Exemplos curl

Busca simples:

```bash
curl -sS -X POST "$BASE/search/text" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Request-Id: demo-001" \
  -d '{ "query": "energia solar", "filter": { "uf": "SP" }, "final_limit": 5 }'
```

Serviço, priorizando a atividade da empresa:

```bash
curl -sS -X POST "$BASE/search/text" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "query": "locação de andaimes para reforma de fachadas", "weight_preset": "escopo", "search_focus": "servico", "final_limit": 5 }'
```

Produto, priorizando quem atende o perfil do comprador, com rerank:

```bash
curl -sS -X POST "$BASE/search/text?rerank=1" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "query": "pré-moldados de concreto para armazéns de grãos", "weight_preset": "publico_alvo", "search_focus": "produto", "final_limit": 8 }'
```

---

## 14. MCP — `POST|GET|DELETE /mcp`

### O que faz

Expõe o mesmo domínio via **MCP Streamable HTTP** (JSON-RPC). Tools espelham REST. Sessões mantidas em memória no processo.

### Como funciona

1. Auth alinhada ao REST (`Authorization` / `X-Api-Key`). Se `AUTH_MODE ≠ off` e sem credencial → JSON-RPC error `-32001`.
2. Rate limit 120/min.
3. **POST** sem `mcp-session-id` + body `initialize` → cria sessão, devolve session id.
4. Chamadas seguintes enviam header `mcp-session-id`.
5. **GET** mantém stream da sessão; **DELETE** encerra.

### Input — headers MCP

| Header | Quando |
|--------|--------|
| `Authorization` / `X-Api-Key` | Sempre se auth ligada |
| `mcp-session-id` | Após initialize |
| `Content-Type` | `application/json` no POST |

### Input — ciclo (conceitual)

```json
{ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { } }
```

Depois: `tools/list`, `tools/call`, etc. (conforme SDK MCP do cliente).

### Output — erro auth (exemplo)

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32001,
    "message": "Informe Authorization: Bearer <token|key> ou X-Api-Key"
  },
  "id": null
}
```

### Tools — input / output

#### `get_config`

| | |
|--|--|
| **Equivalente REST** | `GET /config` |
| **Input** | `{}` (vazio) |
| **Output** | `content[0].text` = JSON stringificado do config |

#### `search_text`

| | |
|--|--|
| **Equivalente REST** | `POST /search/text` |
| **Input** | Mesmos campos do body de busca (Zod) |
| **Output sucesso** | `content[0].text` = JSON do resultado (`search_id`, `results`, …) |
| **Output erro** | `isError: true` + JSON `{ error, status, code, search_id }` |

Exemplo de argumentos:

```json
{
  "query": "EPI hospitalar",
  "weight_preset": "publico_alvo",
  "search_focus": "produto",
  "filter": { "uf": "RJ" },
  "final_limit": 5
}
```

O JSON devolvido inclui `weights_used`, `weights_source`, `weight_preset` e `search_focus`, como no REST.

#### `list_conversations`

| Arg | Tipo | Default |
|-----|------|---------|
| `limit` | int 1…100 | 30 |
| `offset` | int ≥ 0 | 0 |

**Output:** JSON de `{ items, total }` (igual REST).  
**Erro:** sem `userId` → status 401 no JSON.

#### `get_conversation`

| Arg | Tipo |
|-----|------|
| `id` | uuid (obrigatório) |

**Output:** conversa + `messages` ou 404.

#### `delete_conversation`

| Arg | Tipo |
|-----|------|
| `id` | uuid |

**Annotation:** `destructiveHint: true`.  
**Output:** `{ ok: true, id }` ou 404.

---

## 15. Tipos compartilhados

### `Auth` (visão pública)

```ts
{
  authenticated: boolean
  userId: string | null
  provider: "anonymous" | "api_key" | "supabase" | "entra" | "env_key"
  keyPrefix: string | null
  roles: string[]
  comprador: {
    nome: string | null
    tierBusca: string
    limiteBuscas: number
    buscasRealizadas: number
  } | null
}
```

### `SearchResultItem`

```ts
{
  posicao: number
  id: string | number
  score_final: number
  score_rrf?: number
  scores?: Record<string, number>
  paths?: string[]
  in_both?: boolean
  payload: Record<string, unknown>
}
```

### Display (recomendado para UI)

Após a busca, preferir `mapResultsForDisplay(results)` (`src/search/resultDisplay.js`):

```ts
{
  posicao: number
  nome_empresa: string | null
  local: string | null          // "SP · São Paulo"
  modelo_negocio: string | null
  descricao: string | null      // ≤ 400 chars
  site: string | null
  site_label: string | null
  site_md: string | null
  perfil_url: string | null
  perfil_md: string | null
  cnpj_basico: string | null
}
```

---

## 16. Fora deste catálogo (X-Ray)

Rotas sob `/search/xray*` são **harness QA** (HTML + probes). Não fazem parte do contrato de integração do Agent-Proxy. Em produção: `XRAY_ENABLED=0`.

O chat do X-Ray (`POST /search/xray/chat`) aceita, além de `message`, `final_limit`, `debug` e `rerank`, os campos opcionais `weight_preset` e `search_focus`. Quando `weight_preset` é enviado, ele substitui os pesos do Query Manager; `search_focus` é repassado à busca. Na interface, são os seletores **pré-config** e **foco** ao lado do campo de mensagem.

Ao refazer a busca pelo painel (`search_params`), dimensões sem texto ficam com peso 0, como em `empty_vectors: "ignore"`. Para que elas usem o pedido principal, envie `search_params.empty_vectors: "query"`.

---

## 17. `GET /docs`

### O que faz

Serve esta documentação como páginas HTML navegáveis, com índice lateral, busca nas seções e botão de copiar nos exemplos.

### Como funciona

1. Lê os arquivos `docs/api/*.md` do próprio repositório (fonte única: repo e página mostram o mesmo conteúdo).
2. Converte para HTML no primeiro acesso e mantém em cache até o arquivo mudar.
3. Rota pública, sem autenticação (o conteúdo não tem segredos).

### Rotas

| Rota | Retorno |
|------|---------|
| `GET /docs` | Redireciona para `/docs/guia` |
| `GET /docs/guia` | Guia de uso (HTML) |
| `GET /docs/endpoints` | Este catálogo (HTML) |
| `GET /docs/referencia` | Referência (HTML) |
| `GET /docs/{slug}.md` | Markdown original (`text/markdown`), útil para agentes e ferramentas |

Slug inexistente → `404` JSON padrão.

---

## Changelog

| Data | Nota |
|------|------|
| 2026-10-06 | `empty_vectors` (`query` \| `ignore`) em `POST /search/text` / `search_text` / `search_params` do X-Ray, na resposta e em `/config`; dimensões com peso 0 não são mais consultadas no Qdrant |
| 2026-10-06 | `weight_preset` e `search_focus` em `POST /search/text` / `search_text`; `weights_used` e afins na resposta; `/config` com `weight_presets` e `search_focus`; `PATCH /auth/consultas/:searchId/qualidade`; `GET /docs`; campos novos em `/health` |
| 2026-08-12 | Catálogo completo input/output por endpoint + MCP tools |
