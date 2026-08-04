# ADR 004 — Dual-path RRF v5

## Status

Aceito

## Contexto

Busca B2B precisa combinar sinais densos (multi-vetor) e esparsos (BM25).

## Decisão

Algoritmo **dual-path-rrf-v5**: dois caminhos (BM25-first e dense-first), fusão RRF, filtros allowlisted, rerank LLM opcional. Dimensões e nomes de vetores configuráveis por env.

## Consequências

- Mudanças no ranking são sensíveis a produto — documentar e, se possível, A/B com métricas.
- Contrato de `weights` / `filter` permanece estável para clientes.
