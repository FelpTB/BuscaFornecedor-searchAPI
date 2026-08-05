import { randomUUID } from "node:crypto";
import { resolveAuthContext, anonymousAuth } from "../auth/resolveAuth.js";

/**
 * Middleware Express — auth pluggable (REST).
 * resolveAuthContext é async (Supabase JWT / api_keys).
 */
export function authMiddleware(req, _res, next) {
  Promise.resolve(resolveAuthContext(req.headers))
    .then((auth) => {
      req.auth = auth;
      next();
    })
    .catch((err) => next(err));
}

/** Gera search_id (UUID) para rastreio REST/MCP/logs. */
export function createSearchId() {
  return randomUUID();
}

export { resolveAuthContext, anonymousAuth };
