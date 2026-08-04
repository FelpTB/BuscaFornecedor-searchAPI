import { Router } from "express";
import { authMiddleware, createSearchId } from "../middleware/auth.js";
import { COLLECTION_NAME, executeSearchByText, getPublicConfig } from "../searchService.js";
import { parseSearchTextBody } from "../schemas/searchText.js";
import { AppError } from "../errors/AppError.js";
import { logError } from "../logger.js";

/**
 * Rotas HTTP de negócio.
 * Cada endpoint deve ter tool MCP correspondente (src/mcp/createMcpServer.js).
 */
export function createApiRouter() {
  const router = Router();

  router.use(authMiddleware);

  router.get("/config", (_req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.json(getPublicConfig());
  });

  /**
   * POST /search/text — busca híbrida (embed + dual-path RRF + filtros + pesos).
   * Body: { query, queries?, weights?, filter?, filter_not?, bm25_query?, bm25?, ... }
   */
  router.post("/search/text", async (req, res, next) => {
    const searchId = createSearchId();
    try {
      const parsed = parseSearchTextBody(req.body || {});
      if (!parsed.success) {
        throw AppError.badRequest(parsed.error);
      }

      const payload = await executeSearchByText(parsed.data, {
        debug: req.query.debug === "1" || parsed.data.debug === true,
        rerank: req.query.rerank === "1" || parsed.data.rerank === true,
        searchId,
      });

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("X-Search-Id", payload.search_id || searchId);
      return res.json(payload);
    } catch (err) {
      const status = err.status ?? err.statusCode ?? 500;
      logError("POST /search/text", "Busca por texto falhou", err, {
        collection: COLLECTION_NAME,
        status,
        search_id: searchId,
        request_id: req.requestId,
      });
      return next(err);
    }
  });

  return router;
}

export { executeSearchByText, getPublicConfig };
