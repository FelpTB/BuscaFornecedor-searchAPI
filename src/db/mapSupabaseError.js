/**
 * Mapeia erros Supabase/Postgres para AppError com mensagem acionável.
 */

import { AppError } from "../errors/AppError.js";

/**
 * @param {unknown} err
 * @param {string} [context]
 * @returns {AppError}
 */
export function mapSupabaseError(err, context = "Supabase") {
  const msg = err?.message || String(err);
  const code = err?.code;

  if (
    /does not exist|schema cache|42P01|PGRST205|Could not find the table|relation .+ does not exist/i.test(
      msg,
    )
  ) {
    return new AppError(
      `${context}: tabela/schema ausente. Rode sql/migrations/001_api_keys_aparicoes.sql no SQL Editor do Supabase (schema busca_fornecedor). Detalhe: ${msg}`,
      503,
      { code: "MIGRATION_REQUIRED", details: { supabase_code: code } },
    );
  }

  if (/permission denied|42501|not authorized|Invalid API key/i.test(msg)) {
    return new AppError(`${context}: ${msg}`, 403, {
      code: "SUPABASE_PERMISSION",
      details: { supabase_code: code },
    });
  }

  return new AppError(`${context}: ${msg}`, 502, {
    code: "SUPABASE_ERROR",
    details: { supabase_code: code },
  });
}
