import { Router } from "express";
import { getSearchXrayHtml } from "./xrayHtml.js";
import { runAgentSearch, runManualToolCall } from "./searchAgent.js";
import { fetchCitiesNearby, getCitiesApiBase } from "../clients/citiesApi.js";
import { executeSearchByText, getPublicConfig } from "../searchService.js";
import { logError, logSuccess } from "../logger.js";

/**
 * Rotas X-Ray — harness / pré-proxy Microsoft + Query Manager + Cities API.
 */
export function createXrayRouter() {
  const router = Router();

  router.get("/search/xray", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(getSearchXrayHtml());
  });

  /** Probe direto da API de cidades (debug). */
  router.get("/search/xray/cities/nearby", async (req, res, next) => {
    try {
      const out = await fetchCitiesNearby({
        city_name: req.query.city_name,
        uf: req.query.uf,
        radius_km: req.query.radius_km,
      });
      return res.json({
        cities_api_base: getCitiesApiBase(),
        ...out,
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post("/search/xray/run", async (req, res, next) => {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query) {
      return res.status(400).json({ error: "Campo 'query' é obrigatório" });
    }
    const final_limit = req.body?.final_limit != null ? Number(req.body.final_limit) : 10;

    const geo = {};
    if (typeof req.body?.city_name === "string" && req.body.city_name.trim()) {
      geo.city_name = req.body.city_name.trim();
    }
    if (typeof req.body?.uf === "string" && req.body.uf.trim()) {
      geo.uf = req.body.uf.trim();
    }
    if (req.body?.radius_km != null && req.body.radius_km !== "") {
      geo.radius_km = Number(req.body.radius_km);
    }

    try {
      const out = await runAgentSearch({
        userQuery: query,
        config: getPublicConfig(),
        executeSearchByText,
        final_limit: Number.isInteger(final_limit) && final_limit >= 1 ? final_limit : 10,
        debug: req.body?.debug === true,
        rerank: req.body?.rerank === true,
        geo: Object.keys(geo).length ? geo : undefined,
      });

      logSuccess("POST /search/xray/run", "Query Manager X-Ray executado", {
        query_preview: query.slice(0, 80),
        intent: out.intent,
        geo: out.geo
          ? {
              city: out.geo.city_name,
              uf: out.geo.uf,
              radius_km: out.geo.radius_km,
              cities: out.geo.cities_in_filter,
            }
          : null,
        agent_ms: out.duration_ms,
        search_ms: out.search_duration_ms,
        search_id: out.search?.search_id,
        results: out.search?.results?.length ?? 0,
      });
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.json(out);
    } catch (err) {
      const status = err.status ?? err.statusCode ?? 500;
      logError("POST /search/xray/run", "Agente X-Ray falhou", err, { status });
      return next(err);
    }
  });

  router.post("/search/xray/tool", async (req, res, next) => {
    try {
      let args = req.body?.arguments ?? req.body;

      // Opcional: expandir cidade+raio no tool manual
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

      const out = await runManualToolCall({
        toolArguments: args,
        executeSearchByText,
      });
      logSuccess("POST /search/xray/tool", "Tool call manual X-Ray", {
        search_id: out.search?.search_id,
        results: out.search?.results?.length ?? 0,
      });
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.json(out);
    } catch (err) {
      logError("POST /search/xray/tool", "Tool call manual falhou", err, {
        status: err.status ?? 500,
      });
      return next(err);
    }
  });

  return router;
}
