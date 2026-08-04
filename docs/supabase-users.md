# Supabase — usuários e identidade (BuscaFornecedor)

Inventário live do projeto **abcAdvise** (`hccolkrnyrxcbxuuajwq`, região `sa-east-1`).  
URL: `https://hccolkrnyrxcbxuuajwq.supabase.co`

Documento para guiar a autenticação futura da API+MCP (JWT Supabase → `req.auth`).  
**Não contém secrets.** Contagens aproximadas na data da inspeção (2026-08-04).

---

## Visão geral

```
auth.users (Supabase Auth)          ← identidade (email/phone/JWT)
        │ id uuid PK
        │
        ├── busca_fornecedor.usuario_comprador.id   (FK CASCADE)  ~488
        ├── busca_fornecedor.usuario_fornecedor.id  (FK CASCADE)  ~104
        └── busca_fornecedor.app_admins.user_id     (FK CASCADE)  ~2

busca_fornecedor.consultas.comprador → auth.users.id   (histórico de buscas)
busca_fornecedor.plan_rank           → pesos de plano do fornecedor
```

| Entidade | Papel |
|----------|--------|
| `auth.users` | Conta Auth (login). ~605 users |
| `usuario_comprador` | Perfil de **comprador** (quotas de busca) |
| `usuario_fornecedor` | Perfil de **fornecedor** (plano, CNPJ, créditos) |
| `app_admins` | Flag admin da app |
| `consultas` | Buscas já persistidas (site/WhatsApp etc.) |
| `plan_rank` | Lookup `plano_categoria` → `peso` |

**Não existe** tabela `api_keys` (ainda). O PLANO previa keys com hash — seria migration nova, ou a API autentica via **JWT Supabase** dos users existentes.

Papéis são **disjuntos** nos dados atuais: `both_roles = 0` (ninguém é comprador e fornecedor ao mesmo tempo). ~12 `auth.users` sem perfil BF.

---

## 1. `auth.users` (Supabase Auth)

Colunas relevantes: `id`, `email`, `phone`, `email_confirmed_at`, `phone_confirmed_at`, `role`, `raw_app_meta_data`, `raw_user_meta_data`, `last_sign_in_at`, `banned_until`, `is_anonymous`, `created_at`.

É a âncora de identidade. JWT emitido pelo Auth carrega o `sub` = `id`.

---

## 2. `busca_fornecedor.usuario_comprador`

PK/FK: `id uuid` → `auth.users(id) ON DELETE CASCADE` (default `auth.uid()`).

| Coluna | Tipo | Default | Uso para a API |
|--------|------|---------|----------------|
| `id` | uuid | `auth.uid()` | = `userId` / subject do JWT |
| `nome` | text | | Display |
| `telefone` | text | | Contato |
| `telefone_verificado` | bool | false | Gate opcional |
| `empresa_nome` | text | | Empresa do comprador |
| `tier_busca` | text | `normal` | `normal` (~484) · `especial` (~4) |
| `limite_buscas` | bigint | 50 | Soft quota |
| `buscas_realizadas` | bigint | 0 | Contador |
| `n_acessos` | bigint | 0 | Analytics |
| `fonte` | text | `Site` | `Site` (~320) · `WhatsApp` (~168) |
| `codigo_embaixador` | smallint | | UNIQUE |
| `embaixador_referente_id` | uuid | | Self-FK |
| `created_at` | timestamptz | now() | |

**Para auth da search API:** após validar JWT, carregar esta linha para cotas (`buscas_realizadas < limite_buscas`) e `tier_busca`.

---

## 3. `busca_fornecedor.usuario_fornecedor`

PK/FK: `id uuid` → `auth.users(id) ON DELETE CASCADE`.  
CNPJ composto UNIQUE + FK → `cnpj_db.estabelecimento(cnpj_basico, cnpj_ordem, cnpj_dv)`.

| Coluna | Tipo | Default | Uso |
|--------|------|---------|-----|
| `id` | uuid | `auth.uid()` | = user Auth |
| `nome` / `telefone` | text | | Perfil |
| `cnpj` | text | | CNPJ formatado (opcional) |
| `cnpj_basico/ordem/dv` | text NOT NULL | | Vínculo estabelecimento |
| `plano_categoria` | text | `standard` | Liga a `plan_rank` |
| `selo_exibicao` | text | `Free` | UI |
| `assinatura_ativa` | bool | false | |
| `data_limite_plano` / `subscription_end` | date/tstz | | Validade |
| `n_creditos` / `n_creditos_pagos` / `n_creditos_gastos` | num | 0 | Créditos |
| `cadastro_incompleto` | bool | false | Onboarding |
| `senha_temporaria` / `token_completar_cadastro` | text | | Fluxo completar cadastro (**sensível**) |
| `perfil_completude` | int | 0 | |
| `n_acessos` | bigint | 0 | |
| `upgrade_status` / webhooks elite | | | Billing ops |

Distribuição observada: quase todos `standard` + selo `Free`; há typo `starndard` em 1 registro.

### `plan_rank`

| plano_categoria | peso |
|-----------------|------|
| standard | 1 |
| essencial | 2 |
| pme | 2 |
| profissional | 3 |
| elite | 4 |

---

## 4. `busca_fornecedor.app_admins`

| Coluna | Tipo |
|--------|------|
| `user_id` | uuid PK → `auth.users` |
| `created_at` | timestamptz |
| `created_by` | uuid nullable |

RLS: policy `no direct access` para `authenticated` (acesso efetivo via `service_role` / backend).

---

## 5. `busca_fornecedor.consultas` (histórico de busca)

Já é o “log de buscas” do produto atual (site/n8n), não a tabela `searches` do PLANO.

| Coluna | Notas |
|--------|-------|
| `id` | uuid PK |
| `comprador` | FK → `auth.users` |
| `parametros` / `resultados` | jsonb |
| `status` | text |
| `session_id` / `execution_id` | rastreio n8n |
| `v_produto` … `v_publico`, `bm_25` | textos/queries por dimensão |
| `uf` / `municipio` | arrays (filtro geo) |
| `modelo_negocio` | text |
| `fallback` | bool |
| `origem` | default `site` |
| `qualidade` | text |
| `created_at` | |

A API+MCP pode **gravar** aqui (async) ou criar `searches` dedicada depois — decisão de implementação.

---

## 6. Outros (contexto, não auth)

| Tabela | Nota |
|--------|------|
| `public.comprador` | 1 row; uuid próprio — **não** é o modelo BF principal |
| `public.whatsapp_otp` | OTP WhatsApp (`phone`, `user_id`, `code_hash`) |
| `company_profile` | Perfis empresariais indexados no Qdrant (pipeline) |
| Schemas `plataforma_stakeholder`, `abc_advise`, `cnpj_db` | Outros produtos no mesmo projeto |

---

## RLS (resumo)

- `usuario_comprador` / `usuario_fornecedor`: policies “só os próprios dados” + algumas leituras `anon`/`authenticated` amplas (revisar antes de expor via PostgREST público).
- `app_admins`: bloqueio para `authenticated`.
- `consultas`: insert público + select por dono/sessão.

**Para a API Node:** usar **service role** só no servidor (lookup de perfil/cota), ou validar JWT e consultar com o user client. Nunca embutir service role no MCP cliente.

---

## Implicações para auth da API+MCP

### Caminho recomendado (alinhado aos users existentes)

1. Cliente envia `Authorization: Bearer <supabase_access_token>`.
2. API valida o JWT (`supabase.auth.getUser(token)` ou JWKS).
3. Resolve papéis:
   - row em `usuario_comprador` → role `comprador` + quotas
   - row em `usuario_fornecedor` → role `fornecedor` + plano
   - row em `app_admins` → role `admin`
4. Preenche `req.auth`:

```js
{
  authenticated: true,
  userId: "<auth.users.id>",
  orgId: null,              // não há organizations hoje
  apiKeyId: null,           // até existir api_keys
  roles: ["comprador"],     // ou fornecedor / admin
  tierBusca: "normal",
  limiteBuscas: 50,
  buscasRealizadas: 12,
  keyPrefix: null
}
```

5. Opcional: incrementar `buscas_realizadas` / inserir `consultas` no cold path.

### Alternativa (PLANO api_key)

Criar `api_keys (key_hash, user_id, …)` ligadas a `auth.users` — útil para agentes MCP sem sessão interativa. **Ainda não existe no banco.**

### Extensão de `AUTH_MODE`

Hoje: `off` | `api_key` (lista env).  
Próximo: `supabase_jwt` (e depois `api_key` com hash no Supabase).

---

## Env sugeridos (quando implementar)

```env
SUPABASE_URL=https://hccolkrnyrxcbxuuajwq.supabase.co
SUPABASE_ANON_KEY=          # só se validar no client pattern
SUPABASE_SERVICE_ROLE_KEY=  # só servidor — lookup perfil/cota
AUTH_MODE=supabase_jwt
```

Não commitar keys. Adicionar ao `.env.example` como placeholders.

---

## Gaps vs PLANO_ESCALAVEL

| PLANO | Realidade no Supabase |
|-------|----------------------|
| `organizations` / `profiles` | Não existem; perfis = `usuario_*` |
| `api_keys` | Não existe |
| `searches` / `usage_daily` | Aproximado por `consultas` + contadores em `usuario_comprador` |
| Multi-tenant `org_id` | Ausente — tenant ≈ user |

A auth da API deve **conversar com o modelo real** (`auth.users` + `usuario_comprador`/`usuario_fornecedor`), não assumir o schema teórico do PLANO sem migration.
