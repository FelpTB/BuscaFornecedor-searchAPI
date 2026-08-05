# Database / Supabase

**Projeto live:** abcAdvise (`hccolkrnyrxcbxuuajwq`) · `sa-east-1`  
**URL:** https://hccolkrnyrxcbxuuajwq.supabase.co

Documentação de usuários e identidade: [`supabase-users.md`](supabase-users.md).  
**Plano de implementação (auth + histórico + aparições):** [`plano-supabase-auth.md`](plano-supabase-auth.md).  
ADR: [`010-supabase-hybrid-auth-telemetry.md`](../adr/010-supabase-hybrid-auth-telemetry.md).  
Skill Cursor: `.cursor/skills/supabase-db/`.

## Schema relevante ao BuscaFornecedor

Schema principal: **`busca_fornecedor`**.

| Área | Tabelas |
|------|---------|
| Identidade app | `usuario_comprador`, `usuario_fornecedor`, `app_admins` |
| Credenciais agente *(migration)* | `api_keys` |
| Buscas | `consultas` |
| Aparições *(migration)* | `aparicoes`, `aparicoes_cnpj_agg` |
| Planos | `plan_rank` |
| Índice / pipeline | `company_profile`, `scrape_main`, `scraped_chunks`, … |

Identidade Auth: **`auth.users`** (FK alvo dos perfis).

## Princípios para a API Node

1. Hot path de busca **não** espera write no Postgres.
2. Auth: API key hasheada e/ou JWT Supabase → `userId`; futuro Entra OIDC no mesmo shape.
3. Service role só no servidor; pooler `DATABASE_URL` porta 6543 para writes.
4. Preferir `consultas` + `usuario_comprador`; criar `api_keys` / `aparicoes` conforme plano.
5. Schema teórico antigo do PLANO (`organizations`, `searches`) só se ADR justificar.

## Status no código deste repo

Sem client Supabase runtime ainda. `AUTH_MODE` local (`off` / `api_key` env).  
Próximo: fases S0–S3 em [`plano-supabase-auth.md`](plano-supabase-auth.md).