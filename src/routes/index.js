import { Router } from "express";
import { authMiddleware, createSearchId } from "../middleware/auth.js";
import { COLLECTION_NAME, executeSearchByText, getPublicConfig } from "../searchService.js";
import { parseSearchTextBody } from "../schemas/searchText.js";
import { AppError } from "../errors/AppError.js";
import { logError } from "../logger.js";
import { assertCanSearch, publicAuthView } from "../auth/resolveAuth.js";
import {
  registerBuyer,
  loginBuyer,
  issueApiKeyForUser,
  getProfile,
  revokeUserApiKey,
} from "../auth/registerBuyer.js";
import { maybeEnqueueFromSearch } from "../telemetry/enqueue.js";
import { getConsultaById, getAparicoesAgg } from "../db/repositories/consultasRepo.js";

/**
 * Rotas HTTP de negócio.
 * Cada endpoint de busca deve ter tool MCP correspondente.
 */
export function createApiRouter() {
  const router = Router();

  router.use(authMiddleware);

  router.get("/config", (_req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.json(getPublicConfig());
  });

  /** Quem sou eu (credencial atual). */
  router.get("/auth/me", async (req, res, next) => {
    try {
      if (!req.auth?.authenticated || !req.auth.userId) {
        return res.json({ authenticated: false, auth: publicAuthView(req.auth) });
      }
      const profile = await getProfile(req.auth.userId);
      return res.json({
        authenticated: true,
        auth: publicAuthView(req.auth),
        profile,
      });
    } catch (err) {
      return next(err);
    }
  });

  /** Cadastro comprador + API key (1x). Público (rate-limit futuro). */
  router.post("/auth/register-buyer", async (req, res, next) => {
    try {
      const out = await registerBuyer({
        email: req.body?.email,
        nome: req.body?.nome,
        telefone: req.body?.telefone,
        empresa_nome: req.body?.empresa_nome,
        password: req.body?.password,
        fonte: req.body?.fonte || "API",
        key_name: req.body?.key_name || "api",
      });
      res.status(201).json(out);
    } catch (err) {
      return next(err);
    }
  });

  /** Conta existente: email+senha → nova API key. */
  router.post("/auth/login-buyer", async (req, res, next) => {
    try {
      const out = await loginBuyer({
        email: req.body?.email,
        password: req.body?.password,
        fonte: req.body?.fonte || "API",
        key_name: req.body?.key_name || "api-login",
      });
      res.status(200).json(out);
    } catch (err) {
      return next(err);
    }
  });

  /** Nova API key para usuário autenticado. */
  router.post("/auth/api-keys", async (req, res, next) => {
    try {
      if (!req.auth?.userId) {
        throw AppError.unauthorized(
          "Para emitir nova key, autentique-se antes (Bearer sk_bf_… / JWT) ou use POST /auth/login-buyer com email e senha.",
        );
      }
      const out = await issueApiKeyForUser(req.auth.userId, {
        name: req.body?.name || "agent",
      });
      res.status(201).json(out);
    } catch (err) {
      return next(err);
    }
  });

  router.post("/auth/api-keys/revoke", async (req, res, next) => {
    try {
      if (!req.auth?.userId) throw AppError.unauthorized();
      const out = await revokeUserApiKey(req.auth.userId, req.body?.key_prefix);
      return res.json(out);
    } catch (err) {
      return next(err);
    }
  });

  /** Probe telemetria: consulta salva. */
  router.get("/auth/consultas/:searchId", async (req, res, next) => {
    try {
      if (!req.auth?.userId) throw AppError.unauthorized();
      const row = await getConsultaById(req.params.searchId);
      if (!row) return res.status(404).json({ error: "Consulta não encontrada" });
      if (row.comprador !== req.auth.userId) throw AppError.forbidden();
      return res.json(row);
    } catch (err) {
      return next(err);
    }
  });

  /** Probe aparições por CNPJ. */
  router.get("/auth/aparicoes/:cnpj", async (req, res, next) => {
    try {
      if (!req.auth?.authenticated) throw AppError.unauthorized();
      const agg = await getAparicoesAgg(req.params.cnpj);
      return res.json(agg || { cnpj: req.params.cnpj, total: 0 });
    } catch (err) {
      return next(err);
    }
  });

  /**
   * POST /search/text — busca híbrida.
   */
  router.post("/search/text", async (req, res, next) => {
    const searchId = createSearchId();
    try {
      assertCanSearch(req.auth);

      const parsed = parseSearchTextBody(req.body || {});
      if (!parsed.success) {
        throw AppError.badRequest(parsed.error);
      }

      const payload = await executeSearchByText(parsed.data, {
        debug: req.query.debug === "1" || parsed.data.debug === true,
        rerank: req.query.rerank === "1" || parsed.data.rerank === true,
        searchId,
      });

      maybeEnqueueFromSearch({
        auth: req.auth,
        searchPayload: payload,
        requestParams: parsed.data,
        source: "rest",
      });

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("X-Search-Id", payload.search_id || searchId);
      return res.json({
        ...payload,
        auth: publicAuthView(req.auth),
        telemetry_queued: Boolean(req.auth?.userId),
      });
    } catch (err) {
      const status = err.status ?? err.statusCode ?? 500;
      logError("POST /search/text", "Busca por texto falhou", err, {
        collection: COLLECTION_NAME,
        status,
        search_id: searchId,
        request_id: req.requestId,
        user_id: req.auth?.userId,
      });
      return next(err);
    }
  });

  return router;
}

export { executeSearchByText, getPublicConfig };
