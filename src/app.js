import express from "express";
import helmet from "helmet";
import cors from "cors";
import { mountMcp } from "./mcp/mountMcp.js";
import { createApiRouter, executeSearchByText, getPublicConfig } from "./routes/index.js";
import { createXrayRouter } from "./xray/routes.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { LIMITS, getServerConfig, getCorsOrigins, isProductionRuntime } from "./config/env.js";
import { isXrayEnabled } from "./config/features.js";

/**
 * Factory do app Express — testável e com middleware em ordem fixa.
 *
 * Ordem:
 * 1. trust proxy + helmet + CORS
 * 2. requestId
 * 3. json body
 * 4. health (público)
 * 5. X-Ray (harness — desligável via XRAY_ENABLED=0)
 * 6. API router (auth + business)
 * 7. MCP (auth alinhada)
 * 8. 404 + errorHandler
 */
export function createApp() {
  const app = express();
  const serverCfg = getServerConfig();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  const origins = getCorsOrigins();
  if (origins.length > 0) {
    app.use(
      cors({
        origin(origin, cb) {
          if (!origin || origins.includes(origin)) return cb(null, true);
          return cb(null, false);
        },
        credentials: true,
      }),
    );
  } else if (!isProductionRuntime()) {
    app.use(cors({ origin: true, credentials: true }));
  }

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
      search_xray: isXrayEnabled() ? "/search/xray" : null,
      xray_enabled: isXrayEnabled(),
      auth_mode: serverCfg.authMode,
      auth_modes: serverCfg.authModes,
      require_comprador: serverCfg.requireComprador,
      uptime: process.uptime(),
    });
  });

  // Chat do agente (`/search/xray/chat`) é o backend da UI — sempre montado.
  // XRAY_ENABLED=0 só esconde o harness HTML; não derruba o produto.
  app.use(createXrayRouter());
  app.use(createApiRouter());
  mountMcp(app, { executeSearchByText, getPublicConfig });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
