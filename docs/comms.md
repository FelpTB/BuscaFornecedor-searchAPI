# Camada de comunicacao (notificacao)

Apos uma busca autenticada, a API persiste a consulta e chama a [API notificacao-clientes](https://github.com/maicon-abc-advise/notificacao-clientes) para enfileirar email/SMS por fornecedor.

O n8n continua responsavel por **agendar** claim/envio/confirmacao. Esta API so substitui o trecho **"Recebe Consulta -> Adiciona a fila"**.

## Fluxo

```
Busca (REST / MCP / X-Ray)
  -> maybeEnqueueFromSearch (telemetria)
  -> INSERT consultas (+ aparicoes / contador / comprador)
  -> para cada resultado com cnpj_basico:
       POST /v1/interno/orquestracao/recebe-consulta
  -> n8n (schedule): claim -> envia -> confirmar-consumo
```

A ordem importa: a API de notificacao exige que `id_consulta` ja exista em `busca_fornecedor.consultas` (mesmo Supabase).

## Payload por fornecedor

Espelha o no n8n "Formata a Requisicao":

| Campo | Origem |
|-------|--------|
| `id_consulta` | `search_id` da busca |
| `cnpj_basico` | payload / enrich (8 digitos) |
| `cnpj_ordem` / `cnpj_dv` | so se ambos validos (ou CNPJ 14) |
| `nome_fantasia` | `nome_empresa` / `razao_social` |
| `email_fornecedor` | payload `email` (opcional) |
| `telefone_fornecedor` | payload `telefone` (opcional) |
| `uf` | `filter.uf` (string ou lista) |
| `segmento` | `query` / `query_text` |

## Variaveis

| Env | Default | Descricao |
|-----|---------|-----------|
| `NOTIFICACAO_API_URL` | Railway live | Base URL |
| `NOTIFICACAO_API_KEY` | - | Bearer = `API_KEY` da API de notificacao |
| `NOTIFICACAO_MODE` | `on` | `on` / `off` |
| `NOTIFICACAO_CONCURRENCY` | `3` | POSTs paralelos |
| `NOTIFICACAO_API_TIMEOUT_MS` | `15000` | Timeout HTTP |

Sem `NOTIFICACAO_API_KEY`, a busca e a telemetria seguem normalmente; a fila de comunicacao e ignorada (log warn).

## Codigo

- `src/clients/notificacaoClient.js` - HTTP client
- `src/comms/buildRecebeConsultaPayload.js` - montagem do corpo
- `src/comms/enqueueRecebeConsulta.js` - fila fire-and-forget
- Hook em `src/telemetry/enqueue.js` apos `persistSearchCompleted` ok