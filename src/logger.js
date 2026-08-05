/**
 * Logs estruturados para visibilidade em produção (Railway, Docker, etc.).
 * Formato: [ISO timestamp] [endpoint] level: message { ...details }
 */

function timestamp() {
  return new Date().toISOString();
}

function safeJson(value) {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === "string" && /service_role|eyJ|sk_bf_|password|secret/i.test(v) && v.length > 20) {
        return `[redacted:${v.slice(0, 6)}…]`;
      }
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
    error_message: err?.message ?? String(err),
    error_name: err?.name,
    error_code: err?.code ?? err?.details?.supabase?.code,
    error_status: err?.status ?? err?.statusCode,
    error_details: err?.details ?? err?.details,
    // PostgREST fields if present on the raw error
    postgrest: err
      ? {
          message: err.message,
          code: err.code,
          details: err.details,
          hint: err.hint,
        }
      : undefined,
    error_data: err?.data,
    stack: err?.stack ? err.stack.split("\n").slice(0, 8).join(" | ") : undefined,
  };
  log("ERROR", endpoint, message, errDetail);
  if (err?.stack) {
    console.error(`[${timestamp()}] [${endpoint}] STACK:\n${err.stack}`);
  }
}
