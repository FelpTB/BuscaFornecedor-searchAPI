# Supabase DB — referência

Complemento da skill `supabase-db`. Ler sob demanda.

## Projeto

- Nome: **abcAdvise**
- Ref: `hccolkrnyrxcbxuuajwq`
- URL: `https://hccolkrnyrxcbxuuajwq.supabase.co`
- Região: `sa-east-1`
- Schema app: **`busca_fornecedor`**
- Auth: **`auth.users`**

## Tabelas existentes (relevantes)

### `busca_fornecedor.usuario_comprador`

PK `id` = `auth.users.id`. Cotas: `limite_buscas`, `buscas_realizadas`, `tier_busca`.  
`fonte`: Site | WhatsApp | **Agente** (cadastro via assistente/X-Ray/AgentUI). Cota inicial do Agente: `limite_buscas = 500`.  
`acesso_agente` (boolean, default false): allowlist do modo de busca com agente. Só quem está `true` usa `/search/xray/chat` em produção. Migration `009_acesso_agente.sql`. Alteração da flag: service_role/postgres (trigger bloqueia `authenticated`).

### `busca_fornecedor.consultas`

Histórico de buscas (site/n8n hoje). A API deve gravar aqui.

Campos principais: `id`, `comprador`, `parametros` jsonb, `resultados` jsonb, `status`, `session_id`, `execution_id`, `v_produto`…`v_publico`, `bm_25`, `uf`[], `municipio`[], `modelo_negocio`, `fallback`, `origem`, `qualidade`, `created_at`.

**Convenção API:** `id = search_id` da request.

### `agente_busca_conversas` / `agente_busca_mensagens`

Histórico de chat do agente (X-Ray / API / MCP). `agente_busca_conversas.id` = `session_id` do cliente. Mensagens em cascade (`ON DELETE CASCADE`). Escrita só via service role; SELECT próprio via RLS (`user_id = auth.uid()`). Migrations: `003_conversas_mensagens.sql` (create), `004_rename_agente_busca_conversas.sql` (rename legado `conversas`/`mensagens`).

### Contrato canônico de `consultas` (front)

Produtores `xray`/`api`/`mcp` devem gravar (ou ser normalizados para):

- `parametros`: `descricao`, `tipo_busca`, `cidade_origem`, `ufs_selecionadas`, `cnpjs_existentes`, `raw` (payload do motor)
- `resultados[]`: `{ item: { razao_social, cnpj_basico, nota (0-100), telefone, email, site, … } }`
- `qualidade`: só avaliação (`Ótimo`/`Bom`/`Ruim`/`Péssimo`) — **nunca** intent
- Migration `005_padronizar_consultas_xray.sql`: `normalizar_parametros_consulta`, `enriquecer_resultados_consulta`, triggers, RPC `public.registrar_consulta`

### RLS (defesa em profundidade)

Migration `007_rls_hardening_consultas_aparicoes.sql` (aplicada em abcAdvise 2026-08-10):

| Tabela | authenticated | anon | service_role |
|--------|---------------|------|--------------|
| `consultas` | SELECT/UPDATE próprio (`comprador = auth.uid()`) | deny | bypass (writers API) |
| `aparicoes` | SELECT próprio / via consulta / fornecedor CNPJ | deny | bypass |
| `usuario_comprador` | SELECT/UPDATE próprio (`id = auth.uid()`) | deny | bypass |
| `contador_aparicoes` | SELECT | deny | bypass (writes) |

**Removido:** policies `Permitir leitura pública - *`, `Anyone can create consultas`, `auth users can read usuario_comprador` (SELECT true).


Writer Node: `src/db/repositories/consultasRepo.js` (`buildConsultaParamFields`, `toCanonicalResultItems`).

### `usuario_fornecedor` / `app_admins` / `plan_rank`

Ver `docs/supabase-users.md`. Busca autenticada de produto = papel **comprador**.

## DDL alvo (migrations)

### `api_keys`

```sql
CREATE TABLE IF NOT EXISTS busca_fornecedor.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'default',
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['search']::text[],
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS api_keys_user_id_idx
  ON busca_fornecedor.api_keys (user_id)
  WHERE active = true AND revoked_at IS NULL;
```

### `aparicoes`

```sql
CREATE TABLE IF NOT EXISTS busca_fornecedor.aparicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id uuid NOT NULL REFERENCES busca_fornecedor.consultas(id) ON DELETE CASCADE,
  comprador_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cnpj text NOT NULL,
  nome_empresa text,
  posicao int,
  score_final numeric,
  cidade text,
  uf text,
  origem text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aparicoes_cnpj_created_idx
  ON busca_fornecedor.aparicoes (cnpj, created_at DESC);
CREATE INDEX IF NOT EXISTS aparicoes_consulta_idx
  ON busca_fornecedor.aparicoes (consulta_id);
```

### `aparicoes_cnpj_agg` (opcional)

```sql
CREATE TABLE IF NOT EXISTS busca_fornecedor.aparicoes_cnpj_agg (
  cnpj text PRIMARY KEY,
  total bigint NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
```

## Mapeamento writer `search.completed` → `consultas`

| consultas | evento |
|-----------|--------|
| id | search_id |
| comprador | user_id |
| parametros | params (weights, queries, filter, geo, intent, …) |
| resultados | results_summary allowlist |
| status | completed \| error |
| session_id | session_id X-Ray |
| execution_id | search_id |
| v_* / bm_25 | queries / bm25_query |
| uf / municipio | filter arrays |
| modelo_negocio | filter.modelo_negocio |
| origem | rest \| mcp \| xray \| **agente** (UI do assistente) |
| fallback | false até Fallback Vector |

### Allowlist `resultados[]`

`posicao`, `cnpj`, `nome_empresa`, `cidade`, `uf`, `modelo_negocio`, `score_final`  
(opcional: `score_rrf`, `id` do ponto Qdrant)

## Env

```env
SUPABASE_URL=https://hccolkrnyrxcbxuuajwq.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=postgres://...@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
AUTH_MODE=api_key,supabase_jwt
REQUIRE_COMPRADOR=1
TELEMETRY_MODE=inline
# REDIS_URL=   # se TELEMETRY_MODE=bullmq
```

Pool sugerido (`pg`):

- `max`: 5–10 (API) / 5 (worker)
- `idleTimeoutMillis`: 30000
- `connectionTimeoutMillis`: 5000
- SSL conforme Supabase (`ssl: { rejectUnauthorized: false }` só se exigido pelo runtime — preferir CA correta)

## Pooler

- Porta **6543** = Transaction mode (serverless / muitos clients)
- Porta **5432** = Session (migrations longas, `LISTEN`, etc.)
- Migrations longas: preferir session/direct com cuidado no `max`

## Introspecção rápida (SQL)

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'busca_fornecedor' AND table_name = 'consultas'
ORDER BY ordinal_position;
```

## RLS

- Backend com service role: policies RLS não se aplicam da mesma forma — **filtrar no código**.
- Não expor service role via PostgREST público.
- Revisar policies amplas de `anon` em `usuario_*` antes de qualquer exposição client-side.
