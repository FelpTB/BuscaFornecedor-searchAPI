# Camada de autenticação — BuscaFornecedor API+MCP

**Status:** implementada (ADR 010).  
**Pré-requisito de banco:** migrations `001` + `002` no schema `busca_fornecedor`.

---

## 1. Ideia em uma frase

Toda busca de produto identifica **quem** é o comprador (`auth.users.id`), via **API key** (`sk_bf_…`) ou **JWT Supabase**. Cadastro/login emitem a key **uma vez**; a busca e o MCP usam essa credencial no header.

---

## 2. Peças (quem faz o quê)

```
┌─────────────┐     Bearer / X-Api-Key      ┌──────────────────┐
│ Cliente     │ ──────────────────────────► │ API / MCP / X-Ray│
│ (X-Ray,     │                             │                  │
│  front,     │  POST /auth/register-buyer  │ resolveAuth      │
│  agente)    │  POST /auth/login-buyer     │ assertCanSearch  │
└─────────────┘                             └────────┬─────────┘
                                                     │
                     ┌───────────────────────────────┼───────────────────────────────┐
                     ▼                               ▼                               ▼
            ┌─────────────────┐            ┌─────────────────┐            ┌─────────────────┐
            │ Supabase Auth   │            │ busca_fornecedor│            │ Telemetria async│
            │ auth.users      │◄───────────│ usuario_comprador│───────────►│ consultas +     │
            │ (JWT / senha)   │            │ api_keys (hash) │            │ aparicoes       │
            └─────────────────┘            └─────────────────┘            └─────────────────┘
```

| Peça | Path | Função |
|------|------|--------|
| Resolução de credencial | `src/auth/resolveAuth.js` | Lê header → `AuthContext` |
| Hash / geração de key | `src/auth/apiKeyHash.js` | `sk_bf_…` + SHA-256 |
| Cadastro / login | `src/auth/registerBuyer.js` | Cria user ou valida senha + emite key |
| Repositório | `src/db/repositories/compradorRepo.js` | `usuario_comprador`, `api_keys` |
| Clientes DB | `supabaseAdmin.js` + `pgPool.js` | Service role (Auth/Admin) e pg (writes) |
| Gate de busca | `assertCanSearch` | Exige auth (e comprador se `REQUIRE_COMPRADOR=1`) |
| UI de teste | X-Ray aba Conta | Register / login / colar key |

---

## 3. Identidade canônica

| Conceito | Onde vive |
|----------|-----------|
| Usuário | `auth.users.id` (UUID) |
| Perfil comprador | `busca_fornecedor.usuario_comprador` (`id` = mesmo UUID) |
| Credencial de agente/API | `busca_fornecedor.api_keys` (`key_hash`, nunca plaintext) |
| Sessão web (futuro Entra) | JWT (`supabase_jwt` / depois Entra) |

Sem row em `usuario_comprador`, a pessoa **não** é comprador (role vazia). Com `REQUIRE_COMPRADOR=1`, a busca é bloqueada.

---

## 4. Como se obtém a primeira API key

### A) Conta nova — `POST /auth/register-buyer`

1. API cria `auth.users` (service role)  
2. Garante `usuario_comprador`  
3. Gera `sk_bf_…`, grava só o **hash** em `api_keys`  
4. Devolve `api_key.key` **uma vez**  

X-Ray: **Criar conta + chave** · Chat: tool `register_buyer`

### B) Conta já existente — `POST /auth/login-buyer`

1. `signInWithPassword` (anon key)  
2. Garante perfil comprador  
3. Emite **nova** `sk_bf_…`  
4. Devolve a key uma vez (+ JWT opcional)  

X-Ray: **Já tenho conta** · Chat: tool `login_buyer`

### C) Já autenticado — `POST /auth/api-keys`

Precisa de Bearer/JWT válidos. Só **rotaciona** key; não cria conta.

---

## 5. Como a API reconhece quem está chamando

A cada request (REST) ou sessão MCP:

1. Lê `Authorization: Bearer …` ou `X-Api-Key`  
2. Se **não** houver credencial → `anonymous` (cadastro/login/config ok; **busca** bloqueada se `AUTH_MODE ≠ off`)  
3. Se parecer JWT → `auth.getUser(token)` → `userId` + perfil  
4. Se parecer API key → SHA-256 → lookup em `api_keys` → `userId` + perfil  
5. Fallback legado: `AUTH_API_KEYS` no env  

Resultado: `req.auth` / `AuthContext`:

```json
{
  "authenticated": true,
  "userId": "uuid",
  "provider": "api_key | supabase | env_key",
  "roles": ["comprador"],
  "comprador": { "limiteBuscas": 50, "buscasRealizadas": 3 }
}
```

---

## 6. O que é público vs protegido

| Rota / ação | Credencial? |
|-------------|-------------|
| `POST /auth/register-buyer` | Não |
| `POST /auth/login-buyer` | Não (email+senha no body) |
| `GET /config`, health | Não |
| `POST /auth/api-keys` | Sim |
| `GET /auth/me` | Opcional (mostra anônimo se sem key) |
| `POST /search/text`, MCP `search_text`, chat busca | Sim se `AUTH_MODE=api_key,…` |
| Telemetria (consultas/aparições) | Só após busca autenticada (async) |

---

## 7. Variáveis de ambiente

| Variável | Papel |
|----------|--------|
| `AUTH_MODE=api_key,supabase_jwt` | Liga auth híbrida |
| `REQUIRE_COMPRADOR=0\|1` | Gate extra de perfil/cota |
| `SUPABASE_URL` | Projeto |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin Auth + PostgREST privilegiado |
| `SUPABASE_ANON_KEY` | Login email+senha |
| `DATABASE_URL` | Pooler `:6543` — insert `api_keys` / telemetria via pg |
| `TELEMETRY_MODE=inline` | Grava histórico após busca |

`SUPABASE_CONECTION_STRING` **não** é lida — use `DATABASE_URL`.

---

## 8. Migrations obrigatórias

Aplicadas no projeto **abcAdvise** via Supabase MCP (2026-08-05):

1. **`001_api_keys_aparicoes.sql`** → cria só `busca_fornecedor.api_keys` (+ RLS/grants)  
2. **`002_schema_grants.sql`** → reforça grants  

**Não recria** `aparicoes` nem `aparicoes_cnpj_agg` — no live já existem:

| Tabela live | Uso |
|-------------|-----|
| `aparicoes` | Hits por consulta (`cnpj_basico`/`ordem`/`dv`, ~137k rows) |
| `contador_aparicoes` | Agg por CNPJ básico (8 dígitos) |

A telemetria da API grava nessas tabelas (não em `aparicoes_cnpj_agg`).

Dashboard → Settings → API → **Exposed schemas** → incluir `busca_fornecedor` (para PostgREST; inserts de key usam `DATABASE_URL`/pg).

---

## 9. Fluxo feliz (teste X-Ray)

1. Env corretas + migrations 001/002  
2. `/search/xray` → Conta → criar **ou** login  
3. Copiar `api_key.key` → campo API key → **Usar chave**  
4. Badge: `mode:api_key,supabase_jwt · api_key · comprador`  
5. Buscar no chat → `search_id` → probe consulta (telemetria)

---

## 10. O que ainda não é (de propósito)

- Microsoft Entra ID no proxy (Fase 3) — o shape `provider` já é Entra-ready  
- BullMQ worker (telemetria ainda `inline`)  
- Recuperação de key perdida — só emitir outra via login ou `POST /auth/api-keys`  
- Rate-limit em register/login (planejado)

---

## Referências

- Plano: [`plano-supabase-auth.md`](plano-supabase-auth.md)  
- Implementação: [`implementacao-supabase.md`](implementacao-supabase.md)  
- Usuários live: [`supabase-users.md`](supabase-users.md)  
- ADR: [`../adr/010-supabase-hybrid-auth-telemetry.md`](../adr/010-supabase-hybrid-auth-telemetry.md)
