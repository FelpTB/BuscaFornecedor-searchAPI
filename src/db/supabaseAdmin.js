/**
 * Cliente Supabase Admin (service role) — só servidor.
 */

import { createClient } from "@supabase/supabase-js";

let _admin = null;

export function isSupabaseConfigured() {
  return Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

/** @returns {import("@supabase/supabase-js").SupabaseClient | null} */
export function getSupabaseAdmin() {
  if (!isSupabaseConfigured()) return null;
  if (!_admin) {
    _admin = createClient(
      process.env.SUPABASE_URL.trim(),
      process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }
  return _admin;
}

/** Reset para testes. */
export function _resetSupabaseAdminForTests() {
  _admin = null;
}
