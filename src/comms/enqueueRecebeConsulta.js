/**
 * Camada de comunicacao — enfileira notificacao por fornecedor apos busca.
 * Espelha o fluxo n8n: para cada resultado → POST recebe-consulta.
 *
 * Fire-and-forget: nao bloqueia a resposta da busca.
 * Depende da consulta ja persistida em busca_fornecedor.consultas.
 */

import {
  getNotificacaoMode,
  isNotificacaoConfigured,
  postRecebeConsulta,
  getNotificacaoApiBase,
} from "../clients/notificacaoClient.js";
import { logError, logSuccess, logWarn } from "../logger.js";
import { buildRecebeConsultaBodies } from "./buildRecebeConsultaPayload.js";
import {
  recordCommsEvent,
  getCommsLogs,
  getCommsSummary,
  getCommsStatusSnapshot,
} from "./commsLog.js";


async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Retenta 404 (consulta ainda nao visivel no DB da notificacao). */
async function postRecebeConsultaWithRetry(body, { retries = 4 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await postRecebeConsulta(body);
    } catch (err) {
      lastErr = err;
      if (err?.status !== 404 || attempt === retries) throw err;
      const wait = Math.min(8000, 800 * 2 ** attempt);
      logWarn("comms", "recebe-consulta 404 — retry", {
        id_consulta: body.id_consulta,
        cnpj_basico: body.cnpj_basico,
        attempt: attempt + 1,
        wait_ms: wait,
      });
      recordCommsEvent({
        type: "retry",
        search_id: body.id_consulta,
        id_consulta: body.id_consulta,
        cnpj_basico: body.cnpj_basico,
        status: 404,
        attempt: attempt + 1,
        wait_ms: wait,
      });
      await sleep(wait);
    }
  }
  throw lastErr;
}

const queue = [];
let pumping = false;
const MAX_CONCURRENCY = Number(process.env.NOTIFICACAO_CONCURRENCY) || 3;
let inflight = 0;

/**
 * Enfileira POSTs recebe-consulta apos persistencia bem-sucedida.
 * @returns {{ queued: boolean, reason?: string, count?: number }}
 */
export function enqueueRecebeConsultaAfterPersist({
  search_id,
  enrichedResults = [],
  rawResults = [],
  params = {},
} = {}) {
  if (getNotificacaoMode() === "off") {
    recordCommsEvent({ type: "not_queued", search_id, reason: "notificacao_off" });
    return { queued: false, reason: "notificacao_off" };
  }
  if (!isNotificacaoConfigured()) {
    recordCommsEvent({ type: "not_queued", search_id, reason: "missing_api_key" });
    return { queued: false, reason: "missing_api_key" };
  }
  if (!search_id) {
    recordCommsEvent({ type: "not_queued", reason: "missing_search_id" });
    return { queued: false, reason: "missing_search_id" };
  }

  const bodies = buildRecebeConsultaBodies({
    search_id,
    enrichedResults,
    rawResults,
    params,
  });

  if (!bodies.length) {
    recordCommsEvent({
      type: "not_queued",
      search_id,
      reason: "no_valid_cnpj",
      raw_count: Array.isArray(rawResults) ? rawResults.length : 0,
      enriched_count: Array.isArray(enrichedResults) ? enrichedResults.length : 0,
    });
    return { queued: false, reason: "no_valid_cnpj", count: 0 };
  }

  for (const body of bodies) {
    queue.push(body);
  }

  recordCommsEvent({
    type: "batch_queued",
    search_id,
    count: bodies.length,
    cnpjs: bodies.map((b) => b.cnpj_basico),
    endpoint: `${getNotificacaoApiBase()}/v1/interno/orquestracao/recebe-consulta`,
  });

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
      .then(() => postRecebeConsultaWithRetry(body))
      .then((res) => {
        recordCommsEvent({
          type: "ok",
          search_id: body.id_consulta,
          id_consulta: body.id_consulta,
          cnpj_basico: body.cnpj_basico,
          acao: res?.data?.acao,
          canal: res?.data?.canal,
          motivo: res?.data?.motivo,
          id_externo: res?.data?.id_externo,
          tipo_template: res?.data?.tipo_template,
        });
        logSuccess("comms", "recebe-consulta ok", {
          id_consulta: body.id_consulta,
          cnpj_basico: body.cnpj_basico,
          acao: res?.data?.acao,
          canal: res?.data?.canal,
          motivo: res?.data?.motivo,
        });
      })
      .catch((err) => {
        if (err?.status === 409) {
          recordCommsEvent({
            type: "already",
            search_id: body.id_consulta,
            id_consulta: body.id_consulta,
            cnpj_basico: body.cnpj_basico,
            status: 409,
            message: err.message,
          });
          logWarn("comms", "recebe-consulta ja notificado", {
            id_consulta: body.id_consulta,
            cnpj_basico: body.cnpj_basico,
          });
          return;
        }
        recordCommsEvent({
          type: "error",
          search_id: body.id_consulta,
          id_consulta: body.id_consulta,
          cnpj_basico: body.cnpj_basico,
          status: err?.status,
          code: err?.code,
          message: err?.message,
        });
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

/** Exposto para testes / health / X-Ray. */
export function getCommsQueueDepth() {
  return queue.length + inflight;
}

export { getCommsLogs, getCommsSummary, getCommsStatusSnapshot };