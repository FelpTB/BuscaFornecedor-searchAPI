/**
 * Telemetria async — enqueue fire-and-forget (inline MVP).
 */

import { persistSearchCompleted, summarizeResultsForStorage } from "../db/repositories/consultasRepo.js";
import { enqueueRecebeConsultaAfterPersist } from "../comms/enqueueRecebeConsulta.js";
import { logError, logSuccess, logWarn } from "../logger.js";

const queue = [];
let pumping = false;
const MAX_CONCURRENCY = Number(process.env.TELEMETRY_CONCURRENCY) || 2;
let inflight = 0;
/** @type {Set<Promise<unknown>>} */
const inflightPromises = new Set();

export function getTelemetryMode() {
  return (process.env.TELEMETRY_MODE || "inline").trim().toLowerCase();
}

export function getTelemetryPendingCount() {
  return queue.length + inflight;
}

/**
 * Monta evento a partir da busca.
 * status padrão alinhado ao produto: "concluida".
 */
export function buildSearchCompletedEvent({
  search_id,
  user_id,
  source = "api",
  session_id = null,
  params = {},
  results = [],
  latency_ms = null,
  status = "concluida",
  error_message = null,
}) {
  return {
    type: "search.completed",
    search_id,
    user_id,
    source,
    session_id,
    params,
    // Mantém results brutos + summary; persist faz summarize idempotente
    results,
    results_summary: summarizeResultsForStorage(results),
    latency_ms,
    status: status === "completed" ? "concluida" : status,
    error_message,
    occurred_at: new Date().toISOString(),
  };
}

/**
 * Enfileira sem bloquear o hot path.
 * @returns {{ queued: boolean, reason?: string, mode?: string }}
 */
export function enqueueSearchCompleted(event) {
  const mode = getTelemetryMode();
  if (mode === "off") return { queued: false, reason: "telemetry_off" };
  if (!event?.user_id || !event?.search_id) {
    return { queued: false, reason: "missing_ids" };
  }

  if (mode === "inline" || mode === "bullmq") {
    queue.push(event);
    pump();
    return { queued: true, mode: "inline" };
  }

  return { queued: false, reason: `unknown_mode_${mode}` };
}

function pump() {
  if (pumping) return;
  pumping = true;
  setImmediate(runPump);
}

async function runPump() {
  while (queue.length > 0 && inflight < MAX_CONCURRENCY) {
    const event = queue.shift();
    inflight += 1;
    const job = Promise.resolve()
      .then(() => persistSearchCompleted(event))
      .then((result) => {
        if (result?.skipped) {
          logWarn("telemetry", "search.completed skipped", {
            search_id: event.search_id,
            user_id: event.user_id,
            reason: result.reason,
            backfilled: result.backfilled || false,
            result,
          });
        } else {
          logSuccess("telemetry", "search.completed persistido", {
            search_id: event.search_id,
            user_id: event.user_id,
            result,
          });
        }
        // Comunicação: só após consulta existir no banco (API de notificação exige id_consulta).
        if (result?.ok && result.visible_on_supabase !== false) {
          const queued = enqueueRecebeConsultaAfterPersist({
            search_id: event.search_id,
            enrichedResults: result.results || [],
            rawResults: event.results || [],
            params: event.params || {},
          });
          if (queued.queued) {
            logSuccess("comms", "recebe-consulta enfileirado", {
              search_id: event.search_id,
              count: queued.count,
              via: result.via,
              db_mismatch_recovered: result.db_mismatch_recovered || false,
            });
          } else if (queued.reason && queued.reason !== "notificacao_off") {
            logWarn("comms", "recebe-consulta nao enfileirado", {
              search_id: event.search_id,
              reason: queued.reason,
            });
          }
        } else if (result?.ok && result.visible_on_supabase === false) {
          logWarn("comms", "consulta nao visivel no Supabase — fila de email adiadas", {
            search_id: event.search_id,
            via: result.via,
            reason: result.reason,
            hint: "DATABASE_URL e SUPABASE_URL devem ser o mesmo projeto; notificacao: POSTGRES_SCHEMA=busca_fornecedor",
          });
        }
      })
      .catch((err) => {
        logError("telemetry", "Falha ao persistir search.completed", err, {
          search_id: event.search_id,
          user_id: event.user_id,
        });
      })
      .finally(() => {
        inflight -= 1;
        inflightPromises.delete(job);
        if (queue.length > 0) pump();
      });
    inflightPromises.add(job);
  }
  pumping = false;
  if (queue.length > 0 && inflight < MAX_CONCURRENCY) {
    pumping = true;
    setImmediate(runPump);
  }
}

/**
 * Drena a fila in-memory no shutdown (Railway SIGTERM).
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ drained: boolean, pending: number }>}
 */
export async function flushTelemetry({ timeoutMs = 8_000 } = {}) {
  pump();
  const deadline = Date.now() + Math.max(500, Number(timeoutMs) || 8_000);

  while (getTelemetryPendingCount() > 0 && Date.now() < deadline) {
    if (inflightPromises.size > 0) {
      await Promise.race([
        Promise.allSettled([...inflightPromises]),
        new Promise((r) => setTimeout(r, 250)),
      ]);
    } else if (queue.length > 0) {
      pump();
      await new Promise((r) => setTimeout(r, 50));
    } else {
      break;
    }
  }

  const pending = getTelemetryPendingCount();
  if (pending > 0) {
    logWarn("telemetry", "flush incompleto no shutdown", { pending, timeoutMs });
  }
  return { drained: pending === 0, pending };
}

/** Helper: enfileira após busca autenticada. */
export function maybeEnqueueFromSearch({
  auth,
  searchPayload,
  requestParams,
  source,
  session_id,
}) {
  if (!auth?.userId) {
    logWarn("telemetry", "busca sem userId — telemetria nao enfileirada", {
      source,
      search_id: searchPayload?.search_id || null,
      reason: "anonymous",
    });
    return { queued: false, reason: "anonymous" };
  }
  const event = buildSearchCompletedEvent({
    search_id: searchPayload?.search_id,
    user_id: auth.userId,
    source,
    session_id,
    params: {
      ...requestParams,
      intent: requestParams?.intent || null,
      query: requestParams?.query || requestParams?.query_text || null,
      bm25_query: requestParams?.bm25_query || null,
      exact_terms: requestParams?.exact_terms || null,
      parent_search_id: searchPayload?.parent_search_id || requestParams?.parent_search_id || null,
      fallback: Boolean(requestParams?.fallback || searchPayload?.fallback),
    },
    results: searchPayload?.results || [],
    latency_ms: searchPayload?.latency_ms ?? null,
    status: "concluida",
  });
  const out = enqueueSearchCompleted(event);
  if (!out.queued) {
    logWarn("telemetry", "enqueue recusado", {
      source,
      search_id: event.search_id,
      user_id: event.user_id,
      reason: out.reason,
    });
  }
  return out;
}
