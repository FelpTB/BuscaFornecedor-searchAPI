/**
 * Ring buffer in-memory dos eventos da camada de comunicacao.
 * Usado pelo X-Ray para inspecionar se recebe-consulta rodou (sem depender de logs Railway).
 */

const MAX_EVENTS = Number(process.env.COMMS_LOG_MAX) || 800;
/** @type {object[]} */
const events = [];
/** @type {Map<string, { expected: number, queued_at: string }>} */
const batches = new Map();

/**
 * @param {object} event
 */
export function recordCommsEvent(event) {
  if (!event || typeof event !== "object") return;
  const row = {
    ts: new Date().toISOString(),
    ...event,
  };
  events.push(row);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }

  const sid = row.search_id || row.id_consulta;
  if (row.type === "batch_queued" && sid) {
    batches.set(String(sid), {
      expected: Number(row.count) || 0,
      queued_at: row.ts,
    });
  }
}

/**
 * @param {{ search_id?: string, limit?: number }} [opts]
 */
export function getCommsLogs({ search_id, limit = 120 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 120, 1), 500);
  let list = events;
  if (search_id) {
    const id = String(search_id);
    list = list.filter((e) => e.search_id === id || e.id_consulta === id);
  }
  return list.slice(-lim);
}

/**
 * Resumo por search_id (ou global se omitido).
 */
export function getCommsSummary(search_id) {
  const logs = getCommsLogs({ search_id, limit: 400 });
  const ok = logs.filter((e) => e.type === "ok").length;
  const error = logs.filter((e) => e.type === "error").length;
  const already = logs.filter((e) => e.type === "already").length;
  const skipped = logs.filter((e) => e.type === "skipped" || e.type === "not_queued").length;
  const batch = search_id ? batches.get(String(search_id)) : null;
  const expected = batch?.expected ?? null;
  const finished = expected != null ? ok + error + already >= expected : null;

  return {
    search_id: search_id || null,
    expected,
    ok,
    error,
    already,
    skipped,
    finished,
    queued_at: batch?.queued_at || null,
    recent: logs.slice(-40),
  };
}

export function getCommsStatusSnapshot() {
  const last = events.slice(-15);
  return {
    events_buffered: events.length,
    batches_tracked: batches.size,
    last_events: last,
  };
}