/**
 * Sessões de chat X-Ray em memória (pré-proxy / demo).
 * TTL default 60 min; limpeza opportunista a cada acesso.
 */

import { randomUUID } from "node:crypto";

const TTL_MS = Number(process.env.XRAY_CHAT_TTL_MS) || 60 * 60 * 1000;
const MAX_MESSAGES = Number(process.env.XRAY_CHAT_MAX_MESSAGES) || 40;

/** @type {Map<string, { id: string, messages: object[], lastSearch: object|null, lastPlan: object|null, createdAt: number, updatedAt: number }>} */
const sessions = new Map();

function now() {
  return Date.now();
}

export function purgeExpiredSessions(at = now()) {
  for (const [id, s] of sessions) {
    if (at - s.updatedAt > TTL_MS) sessions.delete(id);
  }
}

/**
 * @param {string|null|undefined} sessionId
 */
export function getOrCreateSession(sessionId) {
  purgeExpiredSessions();
  const id =
    typeof sessionId === "string" && sessionId.trim()
      ? sessionId.trim()
      : randomUUID();

  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      messages: [],
      lastSearch: null,
      lastPlan: null,
      createdAt: now(),
      updatedAt: now(),
    };
    sessions.set(id, s);
  } else {
    s.updatedAt = now();
  }
  return s;
}

/**
 * @param {string} sessionId
 */
export function resetSession(sessionId) {
  purgeExpiredSessions();
  if (typeof sessionId === "string" && sessionId.trim()) {
    sessions.delete(sessionId.trim());
  }
  return getOrCreateSession(null);
}

/**
 * Mantém só as últimas N mensagens OpenAI (user/assistant/tool).
 * @param {object} session
 * @param {object[]} messages
 */
export function setSessionMessages(session, messages) {
  const list = Array.isArray(messages) ? messages : [];
  session.messages = list.length > MAX_MESSAGES ? list.slice(-MAX_MESSAGES) : list;
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

/** Só para testes. */
export function _clearAllSessionsForTests() {
  sessions.clear();
}
