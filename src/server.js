import express from "express";
import "dotenv/config";
import { mountMcp } from "./mcp/mountMcp.js";
import { logSuccess } from "./logger.js";
import { createApiRouter, executeSearchByText, getPublicConfig } from "./routes/index.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Health público (fora do router autenticado) — usado pelo Railway
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    mcp: "/mcp",
    search: "/search/text",
    uptime: process.uptime(),
  });
});

app.use(createApiRouter());

// Mesma lógica de negócio exposta como tools MCP (Streamable HTTP)
mountMcp(app, { executeSearchByText, getPublicConfig });

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
  logSuccess("boot", "BuscaFornecedor API+MCP online", {
    host: HOST,
    port: PORT,
    mcp: "/mcp",
    search: "/search/text",
  });
  console.log(`API http://${HOST}:${PORT}  |  MCP /mcp  |  POST /search/text`);
});

function shutdown(signal) {
  console.log(`${signal} recebido — encerrando...`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
