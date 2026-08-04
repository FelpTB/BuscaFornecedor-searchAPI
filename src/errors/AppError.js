/**
 * Erros HTTP tipados — base para REST e MCP.
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {{ code?: string, details?: unknown }} [opts]
   */
  constructor(message, status = 500, opts = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.statusCode = status;
    this.code = opts.code || "APP_ERROR";
    this.details = opts.details;
  }

  static badRequest(message, details) {
    return new AppError(message, 400, { code: "BAD_REQUEST", details });
  }

  static unauthorized(message = "Não autenticado") {
    return new AppError(message, 401, { code: "UNAUTHORIZED" });
  }

  static forbidden(message = "Acesso negado") {
    return new AppError(message, 403, { code: "FORBIDDEN" });
  }

  static serviceUnavailable(message) {
    return new AppError(message, 503, { code: "SERVICE_UNAVAILABLE" });
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function isAppError(err) {
  return err instanceof AppError || (err && typeof err.status === "number");
}
