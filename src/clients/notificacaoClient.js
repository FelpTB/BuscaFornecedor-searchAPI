/**
 * Cliente HTTP da API notificacao-clientes (fila email/SMS + dashboard).
 * @see https://github.com/maicon-abc-advise/notificacao-clientes
 */

const DEFAULT_BASE =
  process.env.NOTIFICACAO_API_URL?.trim() ||
  "https://notificacao-clientes-buscafornecedor.up.railway.app";

const FETCH_TIMEOUT_MS = Number(process.env.NOTIFICACAO_API_TIMEOUT_MS) || 15_000;

export function getNotificacaoApiBase() {
  return DEFAULT_BASE.replace(/\/$/, "");
}

export function getNotificacaoMode() {
  const raw = (process.env.NOTIFICACAO_MODE || "on").trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false" || raw === "no") return "off";
  return "on";
}

export function isNotificacaoConfigured() {
  return Boolean(process.env.NOTIFICACAO_API_KEY?.trim());
}

/**
 * POST /v1/interno/orquestracao/recebe-consulta
 * Auth: Bearer <API_KEY> ou X-Api-Key (mesma chave da API de notificação).
 *
 * @param {object} body RecebeConsultaCorpo
 * @returns {Promise<{ ok: boolean, status: number, data: object }>}
 */
export async function postRecebeConsulta(body) {
  const apiKey = process.env.NOTIFICACAO_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error("NOTIFICACAO_API_KEY não configurada");
    err.code = "NOTIFICACAO_NOT_CONFIGURED";
    err.status = 503;
    throw err;
  }

  const url = `${getNotificacaoApiBase()}/v1/interno/orquestracao/recebe-consulta`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const err = new Error(
      e?.name === "AbortError"
        ? "Timeout ao chamar notificacao recebe-consulta"
        : `Falha ao chamar notificacao: ${e.message || e}`,
    );
    err.status = 502;
    err.cause = e;
    err.code = "NOTIFICACAO_NETWORK";
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : data.error || data.message || `HTTP ${res.status}`;
    const err = new Error(`notificacao recebe-consulta: ${detail}`);
    err.status = res.status;
    err.data = data;
    err.code = "NOTIFICACAO_HTTP";
    throw err;
  }

  return { ok: true, status: res.status, data };
}
