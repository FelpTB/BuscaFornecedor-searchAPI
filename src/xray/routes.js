import { Router } from "express";
import { getSearchXrayHtml } from "./xrayHtml.js";
import { runAgentSearch, runManualToolCall } from "./searchAgent.js";
import { executeSearchByText, getPublicConfig } from "../searchService.js";
import { logError, logSuccess } from "../logger.js";

/**
 * Rotas X-Ray — harness de teste / pré-proxy Microsoft.
 * Públicas (sem authMiddleware): o UI envia API key nos fetches se AUTH_MODE=api_key.
 * /config e execução de busca respeitam auth quando o browser envia headers.
 *
 * Na prática:
 * - GET  /search/xray       → UI
 * - POST /search/xray/run   → agente NL → search_text
 * - POST /search/xray/tool  → tool call manual
 *
 * Nota: executeSearchByText em si não exige auth; auth está nas rotas /search/text e /mcp.
 * O X-Ray chama o service diretamente (mesmo núcleo) para espelhar a tool MCP.
 */
export function createXrayRouter() {
  const router = Router();

  router.get("/search/xray", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(getSearchXrayHtml());
  });

  router.post("/search/xray/run", async (req, res, next) => {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query) {
      return res.status(400).json({ error: "Campo 'query' é obrigatório" });
    }
    const final_limit = req.body?.final_limit != null ? Number(req.body.final_limit) : 10;

    try {
      const out = await runAgentSearch({
        userQuery: query,
        config: getPublicConfig(),
        executeSearchByText,
        final_limit: Number.isInteger(final_limit) && final_limit >= 1 ? final_limit : 10,
        debug: req.body?.debug === true,
        rerank: req.body?.rerank === true,
      });

      logSuccess("POST /search/xray/run", "Query Manager X-Ray executado", {
        query_preview: query.slice(0, 80),
        intent: out.intent,
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
      const args = req.body?.arguments ?? req.body;
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
