import { randomUUID } from "node:crypto";

/**
 * Anexa X-Request-Id (ou gera) em req/res para correlação de logs.
 */
export function requestIdMiddleware(req, res, next) {
  const incoming = req.headers["x-request-id"];
  const id =
    typeof incoming === "string" && incoming.trim()
      ? incoming.trim().slice(0, 128)
      : randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
