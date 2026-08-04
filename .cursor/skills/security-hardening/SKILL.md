---
name: security-hardening
description: Applies BuscaFornecedor security practices — API keys, validation, tenant isolation, injection defenses. Use when implementing auth, reviewing security, or hardening REST/MCP.
---

# Security Expert

## Prioridade neste repo

1. Fase 1 API key (ADR 005, PLANO)
2. Auth idêntica REST + MCP
3. Rate limit / cotas (Fases 3–5)
4. Logs sem secrets

## Checklist de review

- [ ] Input validado (allowlist / Zod)
- [ ] Sem RCE / eval / SQL cru
- [ ] Sem SSRF a URL do usuário
- [ ] Secrets só em env
- [ ] Multi-tenant: filtros por `org_id` em persistência
- [ ] Respostas de LLM/terceiros validadas como JSON quando parseadas

## Refs

`docs/security.md`, `docs/GUIA_IMPLEMENTACAO.md` §§7–8
