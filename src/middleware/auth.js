/**
 * Stub de autenticação / controle de API keys.
 *
 * Futuro: validar `Authorization: Bearer <key>` (ou header X-API-Key),
 * resolver org/user, checar cota e anexar em `req.auth`.
 * O mesmo middleware deve proteger REST e MCP.
 *
 * Por enquanto: passa tudo (fase de bootstrap).
 */

export function authMiddleware(req, _res, next) {
  req.auth = {
    authenticated: false,
    apiKeyId: null,
    userId: null,
    orgId: null,
  };
  next();
}
