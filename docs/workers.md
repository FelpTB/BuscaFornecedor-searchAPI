# Workers e filas (planejado)

**Status:** não há workers nem RabbitMQ neste repo hoje.

## Plano deste repositório (PLANO)

- Fila: **Redis / BullMQ**
- Evento: `search.completed` (fire-and-forget após responder ao cliente)
- Worker: grava `searches` + usage no Supabase
- Idempotência por `search_id`
- Falha do worker **não** invalida resposta já enviada

Contrato de evento: `PLANO_ESCALAVEL.md` §5.

## Visão GUIA (longo prazo)

RabbitMQ + workers de **execução de busca** (cidade → Query Manager → regional/nacional → fallback), com `operation_id` / `correlation_id`. Isso diverge do modelo sync atual — só adotar com ADR e migração explícita.

Ao criar worker neste repo: skill `/new-worker`.
