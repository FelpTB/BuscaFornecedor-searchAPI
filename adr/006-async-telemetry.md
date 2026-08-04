# ADR 006 — Telemetria assíncrona (BullMQ)

## Status

Proposto (Fase 2 do PLANO)

## Contexto

Registrar buscas para cotas/histórico sem degradar o hot path.

## Decisão

- Após responder, enfileirar `search.completed` no Redis/BullMQ.
- Worker separado grava em Supabase com idempotência por `search_id`.
- At-least-once delivery.

## Consequências

- Dois processos Railway (`api` + `worker`).
- Falha de persistência é métrica operacional, não erro de busca ao cliente.
