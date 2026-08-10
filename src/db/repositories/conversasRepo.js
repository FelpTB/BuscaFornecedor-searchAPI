/**
 * Repositório conversas + mensagens (histórico de chat autenticado).
 * Preferência: pg Pool; fallback PostgREST (service role).
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "../supabaseAdmin.js";
import { getPgPool } from "../pgPool.js";
import { mapSupabaseError } from "../mapSupabaseError.js";
import { logWarn, logInfo } from "../../logger.js";
import { AppError } from "../../errors/AppError.js";

const SCHEMA = "busca_fornecedor";

/**
 * Normaliza mensagens públicas para rows de storage.
 * @param {Array<{ role: string, content?: string|null, metadata?: object }>} messages
 */
export function buildMessageRows(messages = []) {
  const rows = [];
  let seq = 0;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const role = m.role;
    if (role !== "user" && role !== "assistant" && role !== "tool") continue;
    const content =
      typeof m.content === "string"
        ? m.content
        : m.content == null
          ? null
          : String(m.content);
    seq += 1;
    rows.push({
      role,
      content,
      metadata:
        m.metadata && typeof m.metadata === "object" && !Array.isArray(m.metadata)
          ? m.metadata
          : {},
      seq,
    });
  }
  return rows;
}

/**
 * Título curto a partir da 1ª mensagem do usuário.
 * @param {Array<{ role: string, content?: string|null }>} messages
 * @param {number} [maxLen]
 */
export function deriveConversationTitle(messages = [], maxLen = 80) {
  const first = (messages || []).find(
    (m) => m?.role === "user" && typeof m.content === "string" && m.content.trim(),
  );
  if (!first) return null;
  const t = first.content.trim().replace(/\s+/g, " ");
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function ensureConfigured() {
  if (!isSupabaseConfigured() && !getPgPool()) {
    return false;
  }
  return isSupabaseConfigured() || Boolean(getPgPool());
}

/**
 * @param {{
 *   id: string,
 *   userId: string,
 *   apiKeyId?: string|null,
 *   keyPrefix?: string|null,
 *   title?: string|null,
 *   source?: string,
 *   lastSearchId?: string|null,
 * }} input
 */
export async function upsertConversa(input) {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  if (!id || !userId) {
    throw AppError.badRequest("conversa id e userId são obrigatórios");
  }
  if (!ensureConfigured()) {
    return { skipped: true, reason: "supabase_not_configured" };
  }

  const apiKeyIdRaw = input.apiKeyId || null;
  const apiKeyId =
    typeof apiKeyIdRaw === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      apiKeyIdRaw,
    )
      ? apiKeyIdRaw
      : null;

  const row = {
    id,
    user_id: userId,
    api_key_id: apiKeyId,
    key_prefix: input.keyPrefix || null,
    title: input.title || null,
    source: input.source || "xray",
    last_search_id: input.lastSearchId || null,
    updated_at: new Date().toISOString(),
  };

  const pool = getPgPool();
  if (pool) {
    await pool.query(
      `INSERT INTO busca_fornecedor.conversas
        (id, user_id, api_key_id, key_prefix, title, source, last_search_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         api_key_id = COALESCE(EXCLUDED.api_key_id, busca_fornecedor.conversas.api_key_id),
         key_prefix = COALESCE(EXCLUDED.key_prefix, busca_fornecedor.conversas.key_prefix),
         title = COALESCE(EXCLUDED.title, busca_fornecedor.conversas.title),
         source = EXCLUDED.source,
         last_search_id = COALESCE(EXCLUDED.last_search_id, busca_fornecedor.conversas.last_search_id),
         updated_at = EXCLUDED.updated_at
       WHERE busca_fornecedor.conversas.user_id = EXCLUDED.user_id`,
      [
        row.id,
        row.user_id,
        row.api_key_id,
        row.key_prefix,
        row.title,
        row.source,
        row.last_search_id,
        row.updated_at,
      ],
    );
    return { ok: true, id, via: "pg" };
  }

  const sb = getSupabaseAdmin();
  const { error } = await sb.schema(SCHEMA).from("conversas").upsert(row, {
    onConflict: "id",
  });
  if (error) throw mapSupabaseError(error, "upsert conversa");
  return { ok: true, id, via: "postgrest" };
}

/**
 * Replace snapshot das mensagens públicas (delete + insert ordenado).
 * @param {string} conversaId
 * @param {string} userId
 * @param {Array<{ role: string, content?: string|null, metadata?: object }>} messages
 */
export async function replaceMessages(conversaId, userId, messages = []) {
  const id = typeof conversaId === "string" ? conversaId.trim() : "";
  const uid = typeof userId === "string" ? userId.trim() : "";
  if (!id || !uid) throw AppError.badRequest("conversaId e userId obrigatórios");
  if (!ensureConfigured()) {
    return { skipped: true, reason: "supabase_not_configured" };
  }

  const rows = buildMessageRows(messages);
  const pool = getPgPool();

  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const own = await client.query(
        `SELECT id FROM busca_fornecedor.conversas WHERE id = $1 AND user_id = $2`,
        [id, uid],
      );
      if (!own.rowCount) {
        throw AppError.forbidden("Conversa não pertence ao usuário");
      }
      await client.query(`DELETE FROM busca_fornecedor.mensagens WHERE conversa_id = $1`, [
        id,
      ]);
      for (const r of rows) {
        await client.query(
          `INSERT INTO busca_fornecedor.mensagens (conversa_id, role, content, metadata, seq)
           VALUES ($1,$2,$3,$4::jsonb,$5)`,
          [id, r.role, r.content, JSON.stringify(r.metadata), r.seq],
        );
      }
      await client.query(
        `UPDATE busca_fornecedor.conversas SET updated_at = now() WHERE id = $1 AND user_id = $2`,
        [id, uid],
      );
      await client.query("COMMIT");
      return { ok: true, count: rows.length, via: "pg" };
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  const sb = getSupabaseAdmin();
  const { data: conv, error: cErr } = await sb
    .schema(SCHEMA)
    .from("conversas")
    .select("id")
    .eq("id", id)
    .eq("user_id", uid)
    .maybeSingle();
  if (cErr) throw mapSupabaseError(cErr, "get conversa for replace");
  if (!conv) throw AppError.forbidden("Conversa não pertence ao usuário");

  const { error: delErr } = await sb
    .schema(SCHEMA)
    .from("mensagens")
    .delete()
    .eq("conversa_id", id);
  if (delErr) throw mapSupabaseError(delErr, "delete mensagens");

  if (rows.length) {
    const insertRows = rows.map((r) => ({
      conversa_id: id,
      role: r.role,
      content: r.content,
      metadata: r.metadata,
      seq: r.seq,
    }));
    const { error: insErr } = await sb.schema(SCHEMA).from("mensagens").insert(insertRows);
    if (insErr) throw mapSupabaseError(insErr, "insert mensagens");
  }

  await sb
    .schema(SCHEMA)
    .from("conversas")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", uid);

  return { ok: true, count: rows.length, via: "postgrest" };
}

/**
 * @param {string} userId
 * @param {{ limit?: number, offset?: number }} [opts]
 */
export async function listConversas(userId, opts = {}) {
  const uid = typeof userId === "string" ? userId.trim() : "";
  if (!uid) throw AppError.unauthorized();
  if (!ensureConfigured()) {
    return { items: [], total: 0, note: "supabase_not_configured" };
  }

  const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 100);
  const offset = Math.max(Number(opts.offset) || 0, 0);

  const pool = getPgPool();
  if (pool) {
    const { rows } = await pool.query(
      `SELECT id, title, source, key_prefix, last_search_id, created_at, updated_at
       FROM busca_fornecedor.conversas
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [uid, limit, offset],
    );
    const countRes = await pool.query(
      `SELECT count(*)::int AS n FROM busca_fornecedor.conversas WHERE user_id = $1`,
      [uid],
    );
    return { items: rows, total: countRes.rows[0]?.n ?? rows.length };
  }

  const sb = getSupabaseAdmin();
  const { data, error, count } = await sb
    .schema(SCHEMA)
    .from("conversas")
    .select("id, title, source, key_prefix, last_search_id, created_at, updated_at", {
      count: "exact",
    })
    .eq("user_id", uid)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw mapSupabaseError(error, "list conversas");
  return { items: data || [], total: count ?? (data || []).length };
}

/**
 * @param {string} userId
 * @param {string} conversaId
 */
export async function getConversa(userId, conversaId) {
  const uid = typeof userId === "string" ? userId.trim() : "";
  const id = typeof conversaId === "string" ? conversaId.trim() : "";
  if (!uid) throw AppError.unauthorized();
  if (!id) throw AppError.badRequest("id obrigatório");
  if (!ensureConfigured()) {
    return null;
  }

  const pool = getPgPool();
  if (pool) {
    const { rows: convRows } = await pool.query(
      `SELECT id, user_id, api_key_id, key_prefix, title, source, last_search_id, created_at, updated_at
       FROM busca_fornecedor.conversas
       WHERE id = $1 AND user_id = $2`,
      [id, uid],
    );
    if (!convRows.length) return null;
    const { rows: msgRows } = await pool.query(
      `SELECT id, role, content, metadata, seq, created_at
       FROM busca_fornecedor.mensagens
       WHERE conversa_id = $1
       ORDER BY seq ASC`,
      [id],
    );
    return { ...convRows[0], messages: msgRows };
  }

  const sb = getSupabaseAdmin();
  const { data: conv, error } = await sb
    .schema(SCHEMA)
    .from("conversas")
    .select(
      "id, user_id, api_key_id, key_prefix, title, source, last_search_id, created_at, updated_at",
    )
    .eq("id", id)
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "get conversa");
  if (!conv) return null;

  const { data: messages, error: mErr } = await sb
    .schema(SCHEMA)
    .from("mensagens")
    .select("id, role, content, metadata, seq, created_at")
    .eq("conversa_id", id)
    .order("seq", { ascending: true });
  if (mErr) throw mapSupabaseError(mErr, "get mensagens");

  return { ...conv, messages: messages || [] };
}

/**
 * @param {string} userId
 * @param {string} conversaId
 */
export async function deleteConversa(userId, conversaId) {
  const uid = typeof userId === "string" ? userId.trim() : "";
  const id = typeof conversaId === "string" ? conversaId.trim() : "";
  if (!uid) throw AppError.unauthorized();
  if (!id) throw AppError.badRequest("id obrigatório");
  if (!ensureConfigured()) {
    return { skipped: true, reason: "supabase_not_configured" };
  }

  const pool = getPgPool();
  if (pool) {
    const { rowCount } = await pool.query(
      `DELETE FROM busca_fornecedor.conversas WHERE id = $1 AND user_id = $2`,
      [id, uid],
    );
    if (!rowCount) return null;
    return { ok: true, id };
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .schema(SCHEMA)
    .from("conversas")
    .delete()
    .eq("id", id)
    .eq("user_id", uid)
    .select("id")
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "delete conversa");
  if (!data) return null;
  return { ok: true, id: data.id };
}

/**
 * Snapshot completo: upsert conversa + replace messages.
 */
export async function persistConversationSnapshot({
  id,
  userId,
  apiKeyId = null,
  keyPrefix = null,
  source = "xray",
  lastSearchId = null,
  title = null,
  messages = [],
}) {
  const derivedTitle = title || deriveConversationTitle(messages);
  const up = await upsertConversa({
    id,
    userId,
    apiKeyId,
    keyPrefix,
    title: derivedTitle,
    source,
    lastSearchId,
  });
  if (up?.skipped) return up;
  const replaced = await replaceMessages(id, userId, messages);
  logInfo("conversas", "snapshot persistido", {
    conversa_id: id,
    user_id: userId,
    messages: replaced.count,
  });
  return { ok: true, ...up, messages: replaced.count };
}

export function _logPersistFailure(err, meta = {}) {
  logWarn("conversas", err?.message || String(err), {
    ...meta,
    code: err?.code,
  });
}
