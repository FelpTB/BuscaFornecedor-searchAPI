---
name: new-worker
description: Scaffold an async telemetry or job worker per PLANO_ESCALAVEL (BullMQ). Use when the user invokes /new-worker or asks to create a queue worker.
disable-model-invocation: true
---

# /new-worker

Baseado em `docs/workers.md` e ADR 006 — **não** RabbitMQ do GUIA salvo pedido explícito.

## Entregar

1. `src/telemetry/events.js` — shape do evento (`search.completed`, …)
2. `src/telemetry/enqueue.js` — publish fire-and-forget (não bloqueia hot path)
3. `worker/index.js` — consumer → Supabase
4. Idempotência por `search_id`
5. Logs estruturados + métricas de falha/lag
6. Documentar serviço Railway em `docs/deployment.md`
7. Env: Redis URL, Supabase service role

## Checklist

- [ ] Hot path não await o write do DB
- [ ] REST e MCP usam o mesmo enqueue
- [ ] Retry com backoff; DLQ ou log de poison messages
- [ ] Secrets fora do log
