# ADR 007 — Visão-alvo de busca assíncrona (GUIA)

## Status

Adiado / visão de longo prazo

## Contexto

`docs/GUIA_IMPLEMENTACAO.md` descreve API/MCP → serviço → RabbitMQ → workers → Query Manager → Qdrant, com `operation_id` e resposta inicial só com ID.

## Decisão

Manter como **norte arquitetural**, não como descrição do código atual. Evolução imediata segue o PLANO (sync search + async telemetry). Adotar o modelo GUIA só com:

- novo contrato de API (`POST` retorna `operation_id`);
- workers de execução de busca;
- ADR superseding `003-hot-path-sync`.

## Consequências

Agentes **não** devem implementar RabbitMQ/FastAPI como se já existissem. Usar o GUIA para segurança, camadas e observabilidade quando aplicável ao stack Node atual.
