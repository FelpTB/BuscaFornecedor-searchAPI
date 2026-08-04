# Segurança

## Controles atuais (v1)

| Área | Estado |
|------|--------|
| Secrets | Env / `.env` gitignored |
| Auth | Pluggable: `AUTH_MODE=off\|api_key` em REST **e** MCP |
| Contrato | `req.auth = { authenticated, apiKeyId, userId, orgId, keyPrefix }` |
| Validação | Zod compartilhado (`schemas/searchText.js`) + regras no service |
| Allowlist filtros | Sim |
| Body size | 2mb |
| Correlação | `X-Request-Id`, `search_id` nos logs/resposta |
| Rate limit / cotas | Não (Fases 3–5) |

Ligar auth local:

```env
AUTH_MODE=api_key
AUTH_API_KEYS=sk_live_dev_1,sk_live_dev_2
```

## Diretrizes ao evoluir

1. **API key (Fase 1):** hash em storage; logar só prefixo; cache TTL; 401/403 padronizados — trocar lookup em `resolveAuthContext` sem mudar portas.
2. **Defesa em profundidade:** rate limit → validação → authz → serviço → persistência.
3. **Prompt injection:** schemas MCP estritos; validar JSON de terceiros/LLM.
4. **SSRF / RCE:** sem fetch/exec a partir de input do usuário.
5. **SQL:** apenas ORM/prepared statements (quando houver Postgres).
6. **Multi-tenant:** isolar por `org_id` em queries, cotas e telemetria.
7. **Observabilidade:** `search_id` / `org_id` nos logs; nunca secrets.

Referência: `GUIA_IMPLEMENTACAO.md` §§7–9 · `PLANO_ESCALAVEL.md` Fases 1 e 5.
