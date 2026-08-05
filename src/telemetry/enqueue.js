/**
 * Telemetria async — enqueue fire-and-forget (inline MVP).
 */

import { persistSearchCompleted, summarizeResultsForStorage } from "../db/repositories/consultasRepo.js";
import { logError, logSuccess } from "../logger.js";

const queue = [];
let pumping = false;
const MAX_CONCURRENCY = Number(process.env.TELEMETRY_CONCURRENCY) || 2;
let inflight = 0;

export function getTelemetryMode() {
  return (process.env.TELEMETRY_MODE || "inline").trim().toLowerCase();
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
 * @returns {{ queued: boolean, reason?: string }}
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
    Promise.resolve()
      .then(() => persistSearchCompleted(event))
      .then((result) => {
        logSuccess("telemetry", "search.completed persistido", {
          search_id: event.search_id,
          user_id: event.user_id,
          result,
        });
      })
      .catch((err) => {
        logError("telemetry", "Falha ao persistir search.completed", err, {
          search_id: event.search_id,
          user_id: event.user_id,
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

/** Helper: enfileira após busca autenticada. */
export function maybeEnqueueFromSearch({
  auth,
  searchPayload,
  requestParams,
  source,
  session_id,
}) {
  if (!auth?.userId) return { queued: false, reason: "anonymous" };
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
    },
    results: searchPayload?.results || [],
    latency_ms: searchPayload?.latency_ms ?? null,
    status: "concluida",
  });
  return enqueueSearchCompleted(event);
}
