/**
 * Cliente Supabase Admin (service role) — só servidor.
 */

import { createClient } from "@supabase/supabase-js";

let _admin = null;
let _auth = null;

export function isSupabaseConfigured() {
  return Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

export function isSupabaseAuthLoginConfigured() {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_ANON_KEY?.trim());
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

/**
 * Cliente para signInWithPassword (preferir anon key).
 * Sem ANON_KEY, tenta service role (alguns ambientes GoTrue aceitam).
 * @returns {import("@supabase/supabase-js").SupabaseClient | null}
 */
export function getSupabaseAuthClient() {
  const url = process.env.SUPABASE_URL?.trim();
  if (!url) return null;
  const key =
    process.env.SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return null;
  if (!_auth) {
    _auth = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _auth;
}

/** Reset para testes. */
export function _resetSupabaseAdminForTests() {
  _admin = null;
  _auth = null;
}
