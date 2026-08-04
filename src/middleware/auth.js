import { randomUUID } from "node:crypto";
import { getAuthMode } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

/**
 * Camada de autenticação pluggable (REST + MCP).
 *
 * AUTH_MODE=off      → passa tudo (bootstrap); ainda anexa req.auth
 * AUTH_MODE=api_key  → exige Bearer ou X-Api-Key ∈ AUTH_API_KEYS (lista csv, fase 1 local)
 *
 * Evolução (PLANO Fase 1): trocar lookup por hash em Supabase + cache Redis,
 * sem mudar o contrato de `req.auth` / `resolveAuthContext`.
 */

/**
 * @typedef {{ authenticated: boolean, apiKeyId: string|null, userId: string|null, orgId: string|null, keyPrefix: string|null }} AuthContext
 */

/** @returns {AuthContext} */
export function anonymousAuth() {
  return {
    authenticated: false,
    apiKeyId: null,
    userId: null,
    orgId: null,
    keyPrefix: null,
  };
}

function extractApiKey(headers) {
  const auth = headers?.authorization || headers?.Authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const x = headers?.["x-api-key"] || headers?.["X-Api-Key"];
  if (typeof x === "string" && x.trim()) return x.trim();
  return null;
}

function configuredKeys() {
  const raw = process.env.AUTH_API_KEYS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve contexto de auth a partir de headers (REST ou MCP).
 * @param {Record<string, string|string[]|undefined>} headers
 * @returns {AuthContext}
 * @throws {AppError}
 */
export function resolveAuthContext(headers = {}) {
  const mode = getAuthMode();

  if (mode === "off") {
    return anonymousAuth();
  }

  const key = extractApiKey(headers);
  if (!key) {
    throw AppError.unauthorized("Informe Authorization: Bearer <key> ou X-Api-Key");
  }

  const allowed = configuredKeys();
  if (allowed.length === 0 || !allowed.includes(key)) {
    throw AppError.unauthorized("API key inválida");
  }

  const prefix = key.length > 8 ? `${key.slice(0, 8)}…` : "****";
  return {
    authenticated: true,
    apiKeyId: `local:${prefix}`,
    userId: null,
    orgId: null,
    keyPrefix: prefix,
  };
}

/**
 * Middleware Express — protege rotas de negócio.
 * Em AUTH_MODE=off não bloqueia (espaço para ligar segurança depois).
 */
export function authMiddleware(req, _res, next) {
  try {
    req.auth = resolveAuthContext(req.headers);
    next();
  } catch (err) {
    next(err);
  }
}

/** Gera search_id (UUID) para rastreio REST/MCP/logs. */
export function createSearchId() {
  return randomUUID();
}
