/**
 * Pool Postgres via Supabase connection pooler (porta 6543).
 * Fallback: se DATABASE_URL ausente, writers usam PostgREST via supabase-js.
 */

import pg from "pg";

const { Pool } = pg;

let _pool = null;

export function isPgPoolConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function buildSslOption() {
  if (process.env.PG_SSL === "0") return false;
  const rejectUnauthorized =
    (process.env.PG_SSL_REJECT_UNAUTHORIZED || "0").trim() === "1" ||
    (process.env.PG_SSL_REJECT_UNAUTHORIZED || "").trim().toLowerCase() === "true";
  const ca = process.env.PG_SSL_CA?.trim();
  if (rejectUnauthorized) {
    return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

/** @returns {import("pg").Pool | null} */
export function getPgPool() {
  if (!isPgPoolConfigured()) return null;
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL.trim(),
      max: Number(process.env.PG_POOL_MAX) || 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ssl: buildSslOption(),
    });
    _pool.on("error", (err) => {
      console.error("[pgPool] idle client error:", err.message);
    });
  }
  return _pool;
}

export async function withClient(fn) {
  const pool = getPgPool();
  if (!pool) throw new Error("DATABASE_URL não configurado");
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function endPgPool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
