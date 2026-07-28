import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { COLLECTION_NAME, executeSearchByText, getPublicConfig } from "../searchService.js";
import { logError } from "../logger.js";

/**
 * Rotas HTTP. Cada endpoint de negócio deve ter tool MCP correspondente
 * (ver src/mcp/createMcpServer.js).
 */
export function createApiRouter() {
  const router = Router();

  // /health fica em server.js (público, fora do auth) para o Railway

  router.use(authMiddleware);

  router.get("/config", (_req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.json(getPublicConfig());
  });

  /**
   * POST /search/text — busca por texto (OpenAI embed + Qdrant híbrido + pesos).
   * Body: { query, queries?, weights?, filter?, filter_not?, bm25_query?, ... }
   */
  router.post("/search/text", async (req, res) => {
    try {
      const payload = await executeSearchByText(req.body || {}, {
        debug: req.query.debug === "1",
        rerank: req.query.rerank === "1",
      });
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.json(payload);
    } catch (err) {
      const status = err.status ?? err.statusCode ?? 500;
      logError("POST /search/text", "Busca por texto falhou", err, {
        collection: COLLECTION_NAME,
        status,
      });
      return res.status(status).json({
        error: err.message || "Falha ao vetorizar query ou buscar no Qdrant",
      });
    }
  });

  return router;
}

export { executeSearchByText, getPublicConfig };
