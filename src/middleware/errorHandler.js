import { AppError, isAppError } from "../errors/AppError.js";
import { logError, logWarn } from "../logger.js";

/**
 * Handler global Express — 4-arg signature.
 * Sempre devolve mensagem + code + details quando existirem (diagnóstico auth/DB).
 */
export function errorHandler(err, req, res, _next) {
  const status = err.status ?? err.statusCode ?? 500;
  const requestId = req.requestId || null;
  const path = req.path || "http";

  if (status >= 500) {
    logError(path, "Erro não tratado", err, {
      request_id: requestId,
      status,
      method: req.method,
    });
  } else if (err instanceof AppError) {
    logWarn(path, err.message, {
      request_id: requestId,
      status,
      code: err.code,
      details: err.details,
      method: req.method,
    });
  } else {
    logWarn(path, err?.message || "Erro HTTP", {
      request_id: requestId,
      status,
      code: err?.code,
      method: req.method,
    });
  }

  if (res.headersSent) return;

  if (err instanceof AppError) {
    return res.status(status).json({
      ...err.toJSON(),
      request_id: requestId,
    });
  }

  // Erros não tipados: em 4xx mostra message; em 5xx inclui diagnóstico sem stack completa
  const body = {
    error:
      status < 500
        ? err.message || "Erro"
        : err.message && err.message !== "Error"
          ? err.message
          : "Erro interno",
    code: err.code || (status >= 500 ? "INTERNAL_ERROR" : "ERROR"),
    request_id: requestId,
  };

  if (err.details || err.hint || err.code) {
    body.details = {
      message: err.message,
      code: err.code,
      details: err.details,
      hint: err.hint,
    };
  }

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
