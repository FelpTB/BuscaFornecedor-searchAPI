import { Router } from "express";
import { getSearchXrayHtml } from "./xrayHtml.js";
import { runAgentSearch, runManualToolCall } from "./searchAgent.js";
import { runChatTurn, resetChatSession } from "./conversationalAgent.js";
import { fetchCitiesNearby, getCitiesApiBase } from "../clients/citiesApi.js";
import { executeSearchByText, getPublicConfig } from "../searchService.js";
import { logError, logSuccess } from "../logger.js";
import { resolveAuthContext, publicAuthView, assertCanSearch } from "../auth/resolveAuth.js";
import {
  registerBuyer,
  loginBuyer,
  issueApiKeyForUser,
  getProfile,
} from "../auth/registerBuyer.js";
import { maybeEnqueueFromSearch } from "../telemetry/enqueue.js";
import { getConsultaById, getAparicoesAgg } from "../db/repositories/consultasRepo.js";
import { isSupabaseConfigured } from "../db/supabaseAdmin.js";
import { probeApiKeysTable } from "../db/repositories/compradorRepo.js";
import { AppError } from "../errors/AppError.js";
import { getAuthModes } from "../config/env.js";

/**
 * Rotas X-Ray — chat + auth/onboarding + probes Supabase.
 */
export function createXrayRouter() {
  const router = Router();

  router.get("/search/xray", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(getSearchXrayHtml());
  });

  router.get("/search/xray/cities/nearby", async (req, res, next) => {
    try {
      const out = await fetchCitiesNearby({
        city_name: req.query.city_name,
        uf: req.query.uf,
        radius_km: req.query.radius_km,
      });
      return res.json({ cities_api_base: getCitiesApiBase(), ...out });
    } catch (err) {
      return next(err);
    }
  });

  /** Status auth/supabase para o painel X-Ray. */
  router.get("/search/xray/auth/status", async (req, res, next) => {
    try {
      let auth = anonymousSafe(req);
      try {
        auth = await resolveAuthContext(req.headers);
      } catch {
        auth = { authenticated: false, provider: "anonymous", roles: [], comprador: null };
      }
      const apiKeys = await probeApiKeysTable();
      return res.json({
        supabase_configured: isSupabaseConfigured(),
        api_keys_table: apiKeys,
        auth: publicAuthView(auth),
        config_auth: getPublicConfig().auth,
        auth_modes_env: getAuthModes(),
        supabase: getPublicConfig().supabase,
        hints: {
          first_key: "Use Criar conta ou Já tenho conta — não o botão Emitir nova key",
          auth_mode: "AUTH_MODE deve ser api_key,supabase_jwt (não off)",
          migration: apiKeys.ok
            ? null
            : "Rode sql/migrations/001_api_keys_aparicoes.sql no Supabase SQL Editor",
        },
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post("/search/xray/auth/register", async (req, res, next) => {
    try {
      const out = await registerBuyer({
        email: req.body?.email,
        nome: req.body?.nome,
        telefone: req.body?.telefone,
        empresa_nome: req.body?.empresa_nome,
        password: req.body?.password,
        fonte: "X-Ray",
        key_name: req.body?.key_name || "xray",
      });
      logSuccess("POST /search/xray/auth/register", "Comprador registrado via X-Ray", {
        user_id: out.user_id,
      });
      return res.status(201).json(out);
    } catch (err) {
      return next(err);
    }
  });

  router.post("/search/xray/auth/login", async (req, res, next) => {
    try {
      const out = await loginBuyer({
        email: req.body?.email,
        password: req.body?.password,
        fonte: "X-Ray",
        key_name: req.body?.key_name || "xray-login",
      });
      logSuccess("POST /search/xray/auth/login", "Login comprador via X-Ray", {
        user_id: out.user_id,
      });
      return res.json(out);
    } catch (err) {
      return next(err);
    }
  });

  router.get("/search/xray/auth/me", async (req, res, next) => {
    try {
      const auth = await resolveAuthContext(req.headers);
      if (!auth.userId) {
        return res.json({ authenticated: false, auth: publicAuthView(auth) });
      }
      const profile = await getProfile(auth.userId);
      return res.json({ authenticated: true, auth: publicAuthView(auth), profile });
    } catch (err) {
      return next(err);
    }
  });

  router.post("/search/xray/auth/api-keys", async (req, res, next) => {
    try {
      const auth = await resolveAuthContext(req.headers);
      if (!auth.userId) {
        throw AppError.unauthorized(
          "Cole uma API key/JWT válida no campo acima, ou use Criar conta / Já tenho conta para obter a primeira chave.",
        );
      }
      const out = await issueApiKeyForUser(auth.userId, { name: req.body?.name || "xray" });
      return res.status(201).json(out);
    } catch (err) {
      return next(err);
    }
  });

  router.get("/search/xray/telemetry/consulta/:searchId", async (req, res, next) => {
    try {
      const auth = await resolveAuthContext(req.headers);
      if (!auth.userId) throw AppError.unauthorized();
      const row = await getConsultaById(req.params.searchId);
      if (!row) return res.status(404).json({ error: "Não encontrada (ainda async?)" });
      if (row.comprador !== auth.userId) throw AppError.forbidden();
      return res.json(row);
    } catch (err) {
      return next(err);
    }
  });

  router.get("/search/xray/telemetry/aparicoes/:cnpj", async (req, res, next) => {
    try {
      await resolveAuthContext(req.headers);
      const agg = await getAparicoesAgg(req.params.cnpj);
      return res.json(agg || { cnpj: req.params.cnpj, total: 0, note: "sem registro ou tabela pendente de migration" });
    } catch (err) {
      return next(err);
    }
  });

  router.post("/search/xray/chat", async (req, res, next) => {
    const message =
      typeof req.body?.message === "string"
        ? req.body.message.trim()
        : typeof req.body?.query === "string"
          ? req.body.query.trim()
          : "";
    if (!message) {
      return res.status(400).json({ error: "Campo 'message' é obrigatório" });
    }

    const final_limit = req.body?.final_limit != null ? Number(req.body.final_limit) : 10;

    try {
      let auth = null;
      try {
        auth = await resolveAuthContext(req.headers);
      } catch {
        auth = { authenticated: false, userId: null, roles: [], comprador: null, provider: "anonymous" };
      }

      const out = await runChatTurn({
        session_id: req.body?.session_id,
        message,
        config: getPublicConfig(),
        executeSearchByText,
        final_limit: Number.isInteger(final_limit) && final_limit >= 1 ? final_limit : 10,
        debug: req.body?.debug === true,
        rerank: req.body?.rerank === true,
        auth,
        assertCanSearch,
        onSearchCompleted: (bundle) => {
          maybeEnqueueFromSearch({
            auth,
            searchPayload: bundle.search,
            requestParams: {
              ...(bundle.mcp_tool_call?.arguments || {}),
              intent: bundle.intent,
            },
            source: "xray",
            session_id: typeof req.body?.session_id === "string" ? req.body.session_id : null,
          });
        },
      });

      logSuccess("POST /search/xray/chat", "Chat X-Ray turno", {
        session_id: out.session_id,
        actions: out.actions?.map((a) => a.tool),
        user_id: auth?.userId,
        search_id: out.search?.search_id,
      });
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.json({
        ...out,
        auth: publicAuthView(auth),
      });
    } catch (err) {
      logError("POST /search/xray/chat", "Chat X-Ray falhou", err, {
        status: err.status ?? 500,
      });
      return next(err);
    }
  });

  router.post("/search/xray/chat/reset", (req, res) => {
    const out = resetChatSession(req.body?.session_id);
    return res.json(out);
  });

  router.post("/search/xray/run", async (req, res, next) => {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query) return res.status(400).json({ error: "Campo 'query' é obrigatório" });
    const final_limit = req.body?.final_limit != null ? Number(req.body.final_limit) : 10;
    const geo = {};
    if (typeof req.body?.city_name === "string" && req.body.city_name.trim()) {
      geo.city_name = req.body.city_name.trim();
    }
    if (typeof req.body?.uf === "string" && req.body.uf.trim()) geo.uf = req.body.uf.trim();
    if (req.body?.radius_km != null && req.body.radius_km !== "") {
      geo.radius_km = Number(req.body.radius_km);
    }

    try {
      let auth = null;
      try {
        auth = await resolveAuthContext(req.headers);
        assertCanSearch(auth);
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
        auth = null;
      }

      const out = await runAgentSearch({
        userQuery: query,
        config: getPublicConfig(),
        executeSearchByText,
        final_limit: Number.isInteger(final_limit) && final_limit >= 1 ? final_limit : 10,
        debug: req.body?.debug === true,
        rerank: req.body?.rerank === true,
        geo: Object.keys(geo).length ? geo : undefined,
      });

      maybeEnqueueFromSearch({
        auth,
        searchPayload: out.search,
        requestParams: {
          ...(out.mcp_tool_call?.arguments || {}),
          intent: out.intent,
        },
        source: "xray",
      });

      return res.json({ ...out, auth: publicAuthView(auth) });
    } catch (err) {
      return next(err);
    }
  });

  router.post("/search/xray/tool", async (req, res, next) => {
    try {
      let args = req.body?.arguments ?? req.body;
      const cityName =
        typeof req.body?.city_name === "string" ? req.body.city_name.trim() : "";
      if (cityName && args && typeof args === "object") {
        const nearby = await fetchCitiesNearby({
          city_name: cityName,
          uf: req.body?.uf,
          radius_km: req.body?.radius_km ?? 50,
        });
        args = {
          ...args,
          filter: {
            ...(args.filter && typeof args.filter === "object" ? args.filter : {}),
            cidade: nearby.city_names,
          },
        };
      }

      let auth = null;
      try {
        auth = await resolveAuthContext(req.headers);
        assertCanSearch(auth);
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
      }

      const out = await runManualToolCall({
        toolArguments: args,
        executeSearchByText,
      });
      maybeEnqueueFromSearch({
        auth,
        searchPayload: out.search,
        requestParams: args,
        source: "xray",
      });
      return res.json({ ...out, auth: publicAuthView(auth) });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

function anonymousSafe() {
  return {
    authenticated: false,
    userId: null,
    provider: "anonymous",
    roles: [],
    comprador: null,
  };
}
