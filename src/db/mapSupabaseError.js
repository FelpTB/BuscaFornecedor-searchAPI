/**
 * Mapeia erros Supabase/Postgres/PostgREST para AppError com mensagem acionável.
 */

import { AppError } from "../errors/AppError.js";
import { logError } from "../logger.js";

/**
 * Lê campos do PostgrestError mesmo quando não são enumeráveis (spread falha).
 * @param {unknown} err
 */
export function serializePostgrestError(err) {
  if (err == null) return { empty: true };
  const out = {
    type: typeof err,
    name: err?.name,
    ctor: err?.constructor?.name,
  };
  for (const key of ["message", "code", "details", "hint", "status", "statusCode"]) {
    try {
      const v = err[key];
      if (v === undefined || v === null) continue;
      out[key] = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : String(v);
    } catch {
      /* ignore */
    }
  }
  try {
    out.ownKeys = Object.getOwnPropertyNames(err);
  } catch {
    out.ownKeys = [];
  }
  try {
    out.jsonClone = JSON.parse(JSON.stringify(err));
  } catch {
    out.jsonClone = null;
  }
  if (typeof err === "string") out.asString = err;
  return out;
}

/**
 * @param {unknown} err
 * @param {Record<string, unknown>} [extraContext]
 */
export function extractSupabaseError(err, extraContext = {}) {
  if (!err) {
    return { message: "erro desconhecido (null)", raw: "null", ...extraContext };
  }

  const pg = serializePostgrestError(err);
  const message =
    (typeof pg.message === "string" && pg.message.trim()) ||
    (typeof err?.error === "string" && err.error.trim()) ||
    "";
  const details =
    typeof pg.details === "string"
      ? pg.details
      : pg.details != null
        ? String(pg.details)
        : undefined;
  const hint = typeof pg.hint === "string" ? pg.hint : pg.hint != null ? String(pg.hint) : undefined;
  const code = pg.code != null ? String(pg.code) : undefined;
  const status = pg.status ?? pg.statusCode;

  const parts = [];
  if (message && message !== "Error") parts.push(message);
  else if (message === "Error") parts.push("Error (mensagem genérica do PostgREST — veja details/hint/code)");
  if (details) parts.push(`details=${details}`);
  if (hint) parts.push(`hint=${hint}`);
  if (code) parts.push(`code=${code}`);
  if (parts.length === 0) {
    parts.push(`PostgREST sem message (raw=${JSON.stringify(pg)})`);
  }

  return {
    message: message || parts.join(" | "),
    code,
    details,
    hint,
    status,
    name: pg.name,
    raw: parts.join(" | "),
    postgrest: pg,
    ...extraContext,
  };
}

function suggestFix(info) {
  const blob = `${info.message} ${info.details || ""} ${info.hint || ""} ${info.code || ""} ${JSON.stringify(info.postgrest || {})}`;

  if (/does not exist|schema cache|42P01|PGRST205|Could not find the table|relation .+ does not exist/i.test(blob)) {
    return {
      httpStatus: 503,
      appCode: "MIGRATION_REQUIRED",
      tip: "Rode sql/migrations/001_api_keys_aparicoes.sql no SQL Editor (schema busca_fornecedor).",
    };
  }
  if (/permission denied|42501|not authorized|Invalid API key|PGRST301/i.test(blob)) {
    return {
      httpStatus: 403,
      appCode: "SUPABASE_PERMISSION",
      tip: "Rode sql/migrations/002_schema_grants.sql e exponha o schema busca_fornecedor em Settings → API → Exposed schemas.",
    };
  }
  if (/23505|duplicate key|unique constraint/i.test(blob)) {
    return {
      httpStatus: 409,
      appCode: "DUPLICATE",
      tip: "Registro duplicado (ex.: key_hash). Tente emitir a key novamente.",
    };
  }
  if (/23503|foreign key|violates foreign key/i.test(blob)) {
    return {
      httpStatus: 502,
      appCode: "FK_VIOLATION",
      tip: "FK falhou (user_id precisa existir em auth.users). Verifique se createUser concluiu.",
    };
  }
  if (/PGRST204|column .* does not exist|Could not find the/i.test(blob)) {
    return {
      httpStatus: 502,
      appCode: "SCHEMA_MISMATCH",
      tip: "Coluna/schema divergente. Confira migration 001 e Reload schema no Dashboard.",
    };
  }
  if (/row-level security|RLS/i.test(blob)) {
    return {
      httpStatus: 403,
      appCode: "RLS_BLOCKED",
      tip: "RLS bloqueou a operação. Use SERVICE_ROLE_KEY no servidor ou ajuste policies.",
    };
  }

  return {
    httpStatus: 502,
    appCode: "SUPABASE_ERROR",
    tip: "PostgREST falhou sem message útil — tente via DATABASE_URL (pg) ou confira grants/RLS/Exposed schemas. Veja details.postgrest no JSON.",
  };
}

/**
 * @param {unknown} err — erro bruto do Supabase/pg (NÃO AppError)
 * @param {string} [context]
 * @param {Record<string, unknown>} [extraContext] — ex.: { insert: {...} }
 * @returns {AppError}
 */
export function mapSupabaseError(err, context = "Supabase", extraContext = {}) {
  const info = extractSupabaseError(err, extraContext);
  const fix = suggestFix(info);

  const message = [`${context}: ${info.raw}`, fix.tip ? `→ ${fix.tip}` : null]
    .filter(Boolean)
    .join(" ");

  const details = {
    context,
    tip: fix.tip,
    supabase: {
      message: info.message,
      code: info.code,
      details: info.details,
      hint: info.hint,
      status: info.status,
      name: info.name,
    },
    postgrest: info.postgrest,
    ...(info.insert ? { insert: info.insert } : {}),
    ...(extraContext.insert ? { insert: extraContext.insert } : {}),
  };

  // Loga o erro bruto + details já normalizados (não o AppError)
  logError("supabase", message, null, {
    ...details,
    raw_error_string: err == null ? null : String(err),
  });

  return new AppError(message, fix.httpStatus, {
    code: fix.appCode,
    details,
  });
}
