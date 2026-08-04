---
name: openai-embeddings
description: Handles OpenAI embeddings and optional LLM rerank in BuscaFornecedor. Use when changing embeddings.js, llmRerank.js, models, dimensions, or prompt/rerank behavior.
---

# OpenAI Embeddings Expert

## Módulos

- `embeddings.js` — `text-embedding-3-small`, embed por dimensão
- `llmRerank.js` — rerank opcional no topo do ranking

## Regras

1. API key só via `OPENAI_API_KEY`.
2. Dimensões de embed alinhadas ao cluster Qdrant (env).
3. Tratar falhas de rede/rate limit com erros tipados/`status` adequados.
4. Não logar prompts completos com PII se evitável.
5. Rerank é opt-in (`rerank` no body) — não tornar default sem produto pedir.
6. Circuit breaker (GUIA) é desejável no futuro; se adicionar, encapsular nestes módulos.
