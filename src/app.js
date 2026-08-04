import express from "express";
import { mountMcp } from "./mcp/mountMcp.js";
import { createApiRouter, executeSearchByText, getPublicConfig } from "./routes/index.js";
import { createXrayRouter } from "./xray/routes.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { LIMITS, getServerConfig } from "./config/env.js";

/**
 * Factory do app Express — testável e com middleware em ordem fixa.
 *
 * Ordem:
 * 1. requestId
 * 2. json body
 * 3. health (público)
 * 4. X-Ray (harness / pré-proxy Microsoft)
 * 5. API router (auth + business)
 * 6. MCP (auth alinhada)
 * 7. 404 + errorHandler
 */
export function createApp() {
  const app = express();
  const serverCfg = getServerConfig();

  app.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: LIMITS.bodyJsonBytes }));

  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "busca-fornecedor-api-mcp",
      version: "1.0.0",
      mcp: "/mcp",
      search: "/search/text",
      config: "/config",
      search_xray: "/search/xray",
      auth_mode: serverCfg.authMode,
      uptime: process.uptime(),
    });
  });

  app.use(createXrayRouter());
  app.use(createApiRouter());
  mountMcp(app, { executeSearchByText, getPublicConfig });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
