/**
 * Persistência async de turnos de chat (fire-and-forget).
 * Só autenticação com userId — anônimo não grava.
 */

import {
  persistConversationSnapshot,
  deriveConversationTitle,
  getConversa,
  _logPersistFailure,
} from "../db/repositories/conversasRepo.js";
import { summarizeResultsForStorage } from "../db/repositories/consultasRepo.js";
import { mapResultsForDisplay } from "../search/resultDisplay.js";
import { isSupabaseConfigured } from "../db/supabaseAdmin.js";
import { getPgPool } from "../db/pgPool.js";
import {
  getOrCreateSession,
  setSessionMessages,
} from "../xray/chatSessions.js";

/**
 * Se a sessão em memória estiver vazia, carrega mensagens públicas do DB.
 * @param {string|null|undefined} sessionId
 * @param {string|null|undefined} userId
 */
export async function hydrateChatSessionIfNeeded(sessionId, userId) {
  const sid =
    typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : "";
  const uid = typeof userId === "string" && userId.trim() ? userId.trim() : "";
  if (!sid || !uid) return null;
  if (!isSupabaseConfigured() && !getPgPool()) return null;

  const session = getOrCreateSession(sid);
  if (session.messages.length > 0) return session;

  try {
    const conv = await getConversa(uid, sid);
    if (!conv?.messages?.length) return session;
    const openaiish = conv.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : "",
      }));
    if (openaiish.length) setSessionMessages(session, openaiish);
    return session;
  } catch (err) {
    _logPersistFailure(err, { conversa_id: sid, user_id: uid, phase: "hydrate" });
    return session;
  }
}

/**
 * Monta lista de mensagens para storage a partir do turno.
 * Inclui user/assistant públicos + opcional tool com resultados resumidos.
 *
 * @param {{
 *   messages?: Array<{ role: string, content?: string|null }>,
 *   search?: object|null,
 *   actions?: object[]|null,
 * }} turn
 */
export function buildPersistableMessages(turn = {}) {
  const out = [];
  const msgs = Array.isArray(turn.messages) ? turn.messages : [];
  for (const m of msgs) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    if (typeof m.content !== "string") continue;
    out.push({ role: m.role, content: m.content, metadata: {} });
  }

  const search = turn.search;
  const results = Array.isArray(search?.results) ? search.results : [];
  if (search?.search_id || results.length) {
    const toolName =
      Array.isArray(turn.actions) && turn.actions.some((a) => a?.tool === "expand_search_fallback")
        ? "expand_search_fallback"
        : "search_suppliers";
    out.push({
      role: "tool",
      content: null,
      metadata: {
        tool: toolName,
        search_id: search?.search_id || null,
        result_count: results.length,
        results: summarizeResultsForStorage(results),
        display: mapResultsForDisplay(results, 20),
        fallback: Boolean(search?.fallback),
      },
    });
  }

  return out;
}

/**
 * Enfileira persistência (não await no hot path do response).
 *
 * @param {{
 *   auth: object|null,
 *   sessionId: string,
 *   messages?: object[],
 *   search?: object|null,
 *   actions?: object[]|null,
 *   source?: string,
 * }} opts
 */
export function persistConversationTurn(opts = {}) {
  const userId = opts.auth?.userId;
  const sessionId =
    typeof opts.sessionId === "string" && opts.sessionId.trim()
      ? opts.sessionId.trim()
      : "";
  if (!userId || !sessionId) return { queued: false, reason: "no_auth_or_session" };
  if (!isSupabaseConfigured() && !getPgPool()) {
    return { queued: false, reason: "supabase_not_configured" };
  }

  const messages = buildPersistableMessages({
    messages: opts.messages,
    search: opts.search,
    actions: opts.actions,
  });
  if (!messages.length) return { queued: false, reason: "empty_messages" };

  const payload = {
    id: sessionId,
    userId,
    apiKeyId: opts.auth?.apiKeyId || null,
    keyPrefix: opts.auth?.keyPrefix || null,
    source: opts.source || "xray",
    lastSearchId: opts.search?.search_id || null,
    title: deriveConversationTitle(messages),
    messages,
  };

  setImmediate(() => {
    persistConversationSnapshot(payload).catch((err) => {
      _logPersistFailure(err, {
        conversa_id: sessionId,
        user_id: userId,
      });
    });
  });

  return { queued: true, conversa_id: sessionId };
}
