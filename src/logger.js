/**
 * Logs estruturados para visibilidade em produção (Railway, Docker, etc.).
 * Formato: [ISO timestamp] [endpoint] level: message { ...details }
 */

function timestamp() {
  return new Date().toISOString();
}

/**
 * Redige só segredos óbvios — NÃO mascara key_prefix (sk_bf_xxxx) nem mensagens de erro.
 */
function looksLikeSecret(value) {
  if (typeof value !== "string") return false;
  if (value.length < 32) return false;
  // JWT
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)) return true;
  // API key completa (não prefixo curto)
  if (/^sk_bf_[A-Za-z0-9_-]{20,}$/.test(value)) return true;
  if (/service_role|supabase.*secret/i.test(value) && value.length > 40) return true;
  if (/password|passwd|secret_key/i.test(value) && value.length > 40) return true;
  return false;
}

function safeJson(value) {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (looksLikeSecret(v)) return `[redacted:${String(v).slice(0, 8)}…]`;
      return v;
    });
  } catch {
    return String(value);
  }
}

function log(level, endpoint, message, details = null) {
  const payload = details ? ` ${safeJson(details)}` : "";
  console.log(`[${timestamp()}] [${endpoint}] ${level}: ${message}${payload}`);
}

export function logSuccess(endpoint, message, details = null) {
  log("SUCCESS", endpoint, message, details);
}

export function logWarn(endpoint, message, details = null) {
  log("WARN", endpoint, message, details);
}

export function logInfo(endpoint, message, details = null) {
  log("INFO", endpoint, message, details);
}

/**
 * @param {string} endpoint
 * @param {string} message
 * @param {unknown} err
 * @param {Record<string, unknown>|null} [details]
 */
export function logError(endpoint, message, err, details = null) {
  const errDetail = {
    ...(details || {}),
  };
  if (err != null) {
    errDetail.error_message = typeof err.message === "string" ? err.message : String(err);
    errDetail.error_name = err.name;
    errDetail.error_code = err.code;
    errDetail.error_status = err.status ?? err.statusCode;
    if (err.details !== undefined) errDetail.error_details = err.details;
    if (err.hint !== undefined) errDetail.error_hint = err.hint;
    if (err.stack) {
      errDetail.stack = err.stack.split("\n").slice(0, 8).join(" | ");
    }
  }
  log("ERROR", endpoint, message, errDetail);
  if (err?.stack) {
    console.error(`[${timestamp()}] [${endpoint}] STACK:\n${err.stack}`);
  }
}
