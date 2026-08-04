# Database / Supabase

**Projeto live:** abcAdvise (`hccolkrnyrxcbxuuajwq`) · `sa-east-1`  
**URL:** https://hccolkrnyrxcbxuuajwq.supabase.co

Documentação de usuários e identidade: [`supabase-users.md`](supabase-users.md).

## Schema relevante ao BuscaFornecedor

Schema principal: **`busca_fornecedor`**.

| Área | Tabelas |
|------|---------|
| Identidade app | `usuario_comprador`, `usuario_fornecedor`, `app_admins` |
| Buscas | `consultas` |
| Planos | `plan_rank` |
| Índice / pipeline | `company_profile`, `scrape_main`, `scraped_chunks`, … |

Identidade Auth: **`auth.users`** (FK alvo dos perfis).

## Princípios para a API Node

1. Hot path de busca **não** espera write no Postgres.
2. Auth futura: validar JWT Supabase → carregar perfil em `usuario_*`.
3. Service role só no servidor; nunca no cliente MCP.
4. Schema teórico do PLANO (`organizations`, `api_keys`, `searches`) **ainda não existe** — criar só se necessário; preferir adaptar ao modelo atual.

## Status no código deste repo

Sem client Supabase ainda. `AUTH_MODE` local (`off` / `api_key` env). Próximo passo: `AUTH_MODE=supabase_jwt`.
