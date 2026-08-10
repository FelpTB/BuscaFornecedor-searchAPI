/**
 * Sessões de chat X-Ray em memória (pré-proxy / demo).
 * TTL default 60 min; limpeza opportunista a cada acesso.
 * Ownership: se session.userId estiver setado, só o mesmo user retoma/reseta.
 */

import { randomUUID } from "node:crypto";
import { AppError } from "../errors/AppError.js";

const TTL_MS = Number(process.env.XRAY_CHAT_TTL_MS) || 60 * 60 * 1000;
const MAX_MESSAGES = Number(process.env.XRAY_CHAT_MAX_MESSAGES) || 40;

/**
 * @typedef {{
 *   id: string,
 *   userId: string|null,
 *   messages: object[],
 *   lastSearch: object|null,
 *   lastPlan: object|null,
 *   createdAt: number,
 *   updatedAt: number,
 * }} ChatSession
 */

/** @type {Map<string, ChatSession>} */
const sessions = new Map();

function now() {
  return Date.now();
}

export function purgeExpiredSessions(at = now()) {
  for (const [id, s] of sessions) {
    if (at - s.updatedAt > TTL_MS) sessions.delete(id);
  }
}

function assertSessionAccess(session, userId) {
  if (!session?.userId) return;
  if (!userId) {
    throw AppError.forbidden(
      "Sessão vinculada a um usuário autenticado. Envie Bearer/X-Api-Key.",
    );
  }
  if (session.userId !== userId) {
    throw AppError.forbidden("Sessão pertence a outro usuário");
  }
}

/**
 * @param {string|null|undefined} sessionId
 * @param {{ userId?: string|null }} [opts]
 * @returns {ChatSession}
 */
export function getOrCreateSession(sessionId, opts = {}) {
  purgeExpiredSessions();
  const userId = opts.userId || null;
  const id =
    typeof sessionId === "string" && sessionId.trim()
      ? sessionId.trim()
      : randomUUID();

  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      userId,
      messages: [],
      lastSearch: null,
      lastPlan: null,
      createdAt: now(),
      updatedAt: now(),
    };
    sessions.set(id, s);
  } else {
    assertSessionAccess(s, userId);
    if (!s.userId && userId) {
      s.userId = userId;
    }
    s.updatedAt = now();
  }
  return s;
}

/**
 * @param {string|null|undefined} sessionId
 * @param {{ userId?: string|null }} [opts]
 */
export function resetSession(sessionId, opts = {}) {
  purgeExpiredSessions();
  const userId = opts.userId || null;
  if (typeof sessionId === "string" && sessionId.trim()) {
    const existing = sessions.get(sessionId.trim());
    if (existing) {
      assertSessionAccess(existing, userId);
      sessions.delete(sessionId.trim());
    }
  }
  return getOrCreateSession(null, { userId });
}

/**
 * Remove sessão da memória sem criar outra (ex.: após DELETE conversa).
 * @param {string} sessionId
 * @param {{ userId?: string|null }} [opts]
 */
export function forgetSession(sessionId, opts = {}) {
  purgeExpiredSessions();
  if (typeof sessionId === "string" && sessionId.trim()) {
    const existing = sessions.get(sessionId.trim());
    if (existing) {
      // DELETE conversa já autenticou o owner — permite limpar se userId bate ou se sessão órfã
      if (existing.userId && opts.userId && existing.userId !== opts.userId) {
        throw AppError.forbidden("Sessão pertence a outro usuário");
      }
      sessions.delete(sessionId.trim());
    }
  }
}

/**
 * Remove cadeias tool incompletas / órfãs — evita erro OpenAI
 * "tool message must be response to tool_calls".
 * @param {object[]} messages
 */
export function sanitizeOpenAiMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const out = [];
  let i = 0;
  while (i < list.length) {
    const m = list[i];
    if (!m || typeof m !== "object") {
      i += 1;
      continue;
    }

    if (m.role === "tool") {
      // órfã sem assistant.tool_calls precedente
      i += 1;
      continue;
    }

    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const ids = new Set(
        m.tool_calls.map((t) => t?.id).filter((id) => typeof id === "string" && id),
      );
      const tools = [];
      let j = i + 1;
      while (j < list.length && list[j]?.role === "tool") {
        tools.push(list[j]);
        j += 1;
      }
      const got = new Set(
        tools.map((t) => t?.tool_call_id).filter((id) => typeof id === "string" && id),
      );
      const complete = ids.size > 0 && [...ids].every((id) => got.has(id));
      if (complete) {
        out.push(m, ...tools);
      }
      i = j;
      continue;
    }

    if (m.role === "user" || m.role === "assistant") {
      out.push(m);
    }
    i += 1;
  }
  return out;
}

/**
 * Mantém só as últimas N mensagens OpenAI (user/assistant/tool),
 * sem cortar no meio de uma cadeia tool_calls → tool.
 * @param {object} session
 * @param {object[]} messages
 */
export function setSessionMessages(session, messages) {
  const sanitized = sanitizeOpenAiMessages(messages);
  if (sanitized.length <= MAX_MESSAGES) {
    session.messages = sanitized;
  } else {
    session.messages = sanitizeOpenAiMessages(sanitized.slice(-MAX_MESSAGES));
  }
  session.updatedAt = now();
}

/**
 * @param {object} session
 * @param {object|null} plan
 * @param {object|null} search
 */
export function setSessionLastSearch(session, plan, search) {
  session.lastPlan = plan || null;
  session.lastSearch = search || null;
  session.updatedAt = now();
}

/** Mensagens visíveis na UI (sem tool dumps). */
export function publicMessages(session) {
  return (session.messages || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));
}

export function sessionStats() {
  return { count: sessions.size, ttl_ms: TTL_MS, max_messages: MAX_MESSAGES };
}

/** @returns {ChatSession|undefined} */
export function getSessionForTests(id) {
  return sessions.get(id);
}

/** Só para testes. */
export function _clearAllSessionsForTests() {
  sessions.clear();
}
