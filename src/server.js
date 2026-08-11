import "dotenv/config";
import { createApp } from "./app.js";
import { validateEnv, getServerConfig } from "./config/env.js";
import { isXrayEnabled } from "./config/features.js";
import { logSuccess } from "./logger.js";
import { flushTelemetry } from "./telemetry/enqueue.js";

const envResult = validateEnv({ soft: process.env.NODE_ENV === "test" });
if (envResult.warnings?.length) {
  for (const w of envResult.warnings) {
    console.warn(`[boot] WARN: ${w}`);
  }
}

const app = createApp();
const { port: PORT, host: HOST, authMode } = getServerConfig();
const xrayOn = isXrayEnabled();

const server = app.listen(PORT, HOST, () => {
  logSuccess("boot", "BuscaFornecedor API+MCP online", {
    host: HOST,
    port: PORT,
    mcp: "/mcp",
    search: "/search/text",
    auth_mode: authMode,
    xray: xrayOn,
  });
  console.log(
    `API http://${HOST}:${PORT}  |  MCP /mcp  |  POST /search/text  |  X-Ray ${xrayOn ? "/search/xray" : "off"}  |  auth=${authMode}`,
  );
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} recebido — encerrando...`);
  try {
    await flushTelemetry({ timeoutMs: 8_000 });
  } catch (e) {
    console.warn("[boot] flush telemetry:", e?.message || e);
  }
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
