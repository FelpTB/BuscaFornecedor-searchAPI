/**
 * Camada de comunicação — enfileira notificação por fornecedor após busca.
 * Espelha o fluxo n8n: para cada resultado → POST recebe-consulta.
 *
 * Fire-and-forget: não bloqueia a resposta da busca.
 * Depende da consulta já persistida em busca_fornecedor.consultas.
 */

import {
  getNotificacaoMode,
  isNotificacaoConfigured,
  postRecebeConsulta,
} from "../clients/notificacaoClient.js";
import { logError, logSuccess, logWarn } from "../logger.js";
import { buildRecebeConsultaBodies } from "./buildRecebeConsultaPayload.js";

const queue = [];
let pumping = false;
const MAX_CONCURRENCY = Number(process.env.NOTIFICACAO_CONCURRENCY) || 3;
let inflight = 0;

/**
 * Enfileira POSTs recebe-consulta após persistência bem-sucedida.
 * @returns {{ queued: boolean, reason?: string, count?: number }}
 */
export function enqueueRecebeConsultaAfterPersist({
  search_id,
  enrichedResults = [],
  rawResults = [],
  params = {},
} = {}) {
  if (getNotificacaoMode() === "off") {
    return { queued: false, reason: "notificacao_off" };
  }
  if (!isNotificacaoConfigured()) {
    return { queued: false, reason: "missing_api_key" };
  }
  if (!search_id) {
    return { queued: false, reason: "missing_search_id" };
  }

  const bodies = buildRecebeConsultaBodies({
    search_id,
    enrichedResults,
    rawResults,
    params,
  });

  if (!bodies.length) {
    return { queued: false, reason: "no_valid_cnpj", count: 0 };
  }

  for (const body of bodies) {
    queue.push(body);
  }
  pump();
  return { queued: true, count: bodies.length };
}

function pump() {
  if (pumping) return;
  pumping = true;
  setImmediate(runPump);
}

async function runPump() {
  while (queue.length > 0 && inflight < MAX_CONCURRENCY) {
    const body = queue.shift();
    inflight += 1;
    Promise.resolve()
      .then(() => postRecebeConsulta(body))
      .then((res) => {
        logSuccess("comms", "recebe-consulta ok", {
          id_consulta: body.id_consulta,
          cnpj_basico: body.cnpj_basico,
          acao: res?.data?.acao,
          canal: res?.data?.canal,
          motivo: res?.data?.motivo,
        });
      })
      .catch((err) => {
        // 409 = já notificado (trava Redis) — esperado em retry
        if (err?.status === 409) {
          logWarn("comms", "recebe-consulta já notificado", {
            id_consulta: body.id_consulta,
            cnpj_basico: body.cnpj_basico,
          });
          return;
        }
        logError("comms", "Falha recebe-consulta", err, {
          id_consulta: body.id_consulta,
          cnpj_basico: body.cnpj_basico,
          status: err?.status,
          code: err?.code,
        });
      })
      .finally(() => {
        inflight -= 1;
        if (queue.length > 0) pump();
      });
  }
  pumping = false;
  if (queue.length > 0 && inflight < MAX_CONCURRENCY) {
    pumping = true;
    setImmediate(runPump);
  }
}

/** Exposto para testes / health. */
export function getCommsQueueDepth() {
  return queue.length + inflight;
}
