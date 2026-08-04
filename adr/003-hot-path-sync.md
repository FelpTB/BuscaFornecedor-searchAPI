# ADR 003 — Hot path síncrono de busca

## Status

Aceito (fase atual)

## Contexto

Latência aceitável ≈ OpenAI embeddings + Qdrant. Persistência de histórico não deve aumentar o TTFB.

## Decisão

- Executar busca de forma **síncrona** na request.
- Telemetria/histórico (quando existir) via enqueue fire-and-forget (BullMQ), nunca bloqueando a resposta.

## Consequências

- Diferente do GUIA (busca 100% async com `operation_id`).
- Migração para busca async completa exigiria novo ADR e mudança de contrato público.
