/**
 * Mapeia erros Supabase/Postgres/PostgREST para AppError com mensagem acionável.
 */

import { AppError } from "../errors/AppError.js";
import { logError } from "../logger.js";

/**
 * Normaliza PostgrestError | Error | unknown em um objeto diagnóstico.
 * @param {unknown} err
 * @returns {{
 *   message: string,
 *   code?: string,
 *   details?: string,
 *   hint?: string,
 *   status?: number,
 *   name?: string,
 *   raw: string,
 * }}
 */
export function extractSupabaseError(err) {
  if (!err) {
    return { message: "erro desconhecido (null)", raw: "null" };
  }

  // PostgrestError shape: { message, code, details, hint }
  const message =
    (typeof err.message === "string" && err.message.trim()) ||
    (typeof err.error === "string" && err.error.trim()) ||
    (typeof err.msg === "string" && err.msg.trim()) ||
    "";
  const details =
    typeof err.details === "string"
      ? err.details
      : err.details != null
        ? JSON.stringify(err.details)
        : undefined;
  const hint = typeof err.hint === "string" ? err.hint : undefined;
  const code = err.code != null ? String(err.code) : undefined;
  const status = err.status ?? err.statusCode;

  const parts = [];
  if (message && message !== "Error") parts.push(message);
  else if (message === "Error") parts.push("Error (mensagem genérica do PostgREST)");
  if (details) parts.push(`details=${details}`);
  if (hint) parts.push(`hint=${hint}`);
  if (code) parts.push(`code=${code}`);

  const composed =
    parts.length > 0
      ? parts.join(" | ")
      : typeof err === "string"
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();

  return {
    message: message || composed,
    code,
    details,
    hint,
    status,
    name: err.name,
    raw: composed,
    insert_context: err._insert_context || undefined,
  };
}

function suggestFix(info) {
  const blob = `${info.message} ${info.details || ""} ${info.hint || ""} ${info.code || ""}`;

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
      tip: "Coluna/schema divergente do esperado. Confira a migration 001 e o cache do schema (reload schema no Dashboard).",
    };
  }
  if (/row-level security|RLS|42501/i.test(blob)) {
    return {
      httpStatus: 403,
      appCode: "RLS_BLOCKED",
      tip: "RLS bloqueou a operação. Use SERVICE_ROLE_KEY no servidor ou ajuste policies.",
    };
  }

  return {
    httpStatus: 502,
    appCode: "SUPABASE_ERROR",
    tip: "Veja details/hint/code abaixo e os logs do Railway (campo supabase).",
  };
}

/**
 * @param {unknown} err
 * @param {string} [context]
 * @returns {AppError}
 */
export function mapSupabaseError(err, context = "Supabase") {
  const info = extractSupabaseError(err);
  const fix = suggestFix(info);

  const message = [
    `${context}: ${info.raw}`,
    fix.tip ? `→ ${fix.tip}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const details = {
    context,
    supabase: {
      message: info.message,
      code: info.code,
      details: info.details,
      hint: info.hint,
      status: info.status,
      name: info.name,
    },
    tip: fix.tip,
    ...(info.insert_context ? { insert: info.insert_context } : {}),
  };

  logError("supabase", message, err, details);

  return new AppError(message, fix.httpStatus, {
    code: fix.appCode,
    details,
  });
}
