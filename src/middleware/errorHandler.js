import { AppError, isAppError } from "../errors/AppError.js";
import { logError } from "../logger.js";

/**
 * Handler global Express — 4-arg signature.
 * Mantém espaço para mapear códigos de domínio e métricas.
 */
export function errorHandler(err, req, res, _next) {
  const status = err.status ?? err.statusCode ?? 500;
  const requestId = req.requestId || null;

  if (status >= 500) {
    logError(req.path || "http", "Erro não tratado", err, {
      request_id: requestId,
      status,
    });
  }

  if (res.headersSent) return;

  const body =
    err instanceof AppError
      ? { ...err.toJSON(), request_id: requestId }
      : {
          error: status < 500 ? err.message || "Erro" : "Erro interno",
          code: err.code || (status >= 500 ? "INTERNAL_ERROR" : "ERROR"),
          request_id: requestId,
        };

  res.status(status).json(body);
}

/** 404 JSON padronizado. */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: `Rota não encontrada: ${req.method} ${req.path}`,
    code: "NOT_FOUND",
    request_id: req.requestId || null,
  });
}

export function assertAppError(err) {
  if (isAppError(err)) return err;
  return new AppError(err?.message || "Erro interno", err?.status ?? 500);
}
