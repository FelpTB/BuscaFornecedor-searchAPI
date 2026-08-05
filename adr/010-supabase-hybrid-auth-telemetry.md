# ADR 010 — Auth híbrida Entra-ready + telemetria Supabase

## Status

Aceito (planejamento) — implementação por fases em `docs/plano-supabase-auth.md`

## Contexto

A API precisa (1) identificar o comprador, (2) gravar histórico em `consultas`, (3) contar aparições de CNPJ, sem bloquear o hot path. O thin client / agente MCP precisa de uma chave estável ligada ao perfil. O proxy Microsoft futuro exige compatibilidade com Entra ID (OIDC).

## Decisão

1. **Identidade canônica:** `auth.users.id`. Buscas de produto exigem row em `usuario_comprador`.
2. **Credenciais pluggáveis** no mesmo `req.auth`:
   - API key hasheada em `busca_fornecedor.api_keys` (agentes / MCP)
   - JWT Supabase (sessão interativa)
   - Futuro: token Entra OIDC mapeado ao mesmo `userId` (sem mudar regras de busca)
3. **Onboarding via agente:** tools `register_buyer` / `issue_api_key` criam conta + chave; a conversa guia o cadastro.
4. **Histórico:** reutilizar `busca_fornecedor.consultas` com `id = search_id`.
5. **Aparições:** nova tabela `busca_fornecedor.aparicoes` (+ agg opcional).
6. **Cold path:** enqueue fire-and-forget após a resposta; MVP in-process; escala com BullMQ (ADR 006).
7. **Acesso DB:** service role + `pg` Pool via pooler Supabase (porta 6543); nunca service role no cliente.

## Consequências

- Migrations novas: `api_keys`, `aparicoes`.
- `AUTH_MODE` passa a aceitar combinação (`api_key,supabase_jwt`).
- Critérios de aceite 2, 5 e 6 dependem das fases S1–S3 do plano.
- ADR 005 e 009 permanecem válidos como especializações deste modelo híbrido.
- ADR 009 status → alinhado a este ADR (JWT é um dos providers).
