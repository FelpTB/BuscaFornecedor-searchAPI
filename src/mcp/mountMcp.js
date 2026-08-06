import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./createMcpServer.js";
import { resolveAuthContext } from "../middleware/auth.js";
import { getAuthModes } from "../config/env.js";
import { logError, logSuccess } from "../logger.js";

/**
 * Monta MCP Streamable HTTP em /mcp (POST/GET/DELETE).
 * Auth alinhada ao REST via resolveAuthContext (async).
 */
export function mountMcp(app, deps) {
  const transports = Object.create(null);
  /** Auth do request HTTP atual (tools MCP leem via getAuth). */
  let activeAuth = null;
  const mcpDeps = {
    ...deps,
    getAuth: () => activeAuth,
  };

  const requireMcpAuth = async (req, res) => {
    try {
      req.auth = await resolveAuthContext(req.headers, { optional: true });
      const modes = getAuthModes();
      const authRequired = !(modes.length === 1 && modes[0] === "off");
      if (authRequired && !req.auth?.authenticated) {
        res.status(401).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Informe Authorization: Bearer <token|key> ou X-Api-Key",
          },
          id: null,
        });
        return false;
      }
      return true;
    } catch (err) {
      const status = err.status ?? 401;
      res.status(status).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: err.message || "Unauthorized",
        },
        id: null,
      });
      return false;
    }
  };

  const mcpPostHandler = async (req, res) => {
    if (!(await requireMcpAuth(req, res))) return;
    activeAuth = req.auth;

    const sessionId = req.headers["mcp-session-id"];

    try {
      let transport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports[sid] = transport;
            logSuccess("MCP", "SessÃ£o inicializada", {
              session_id: sid,
              auth: req.auth?.authenticated ?? false,
            });
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            delete transports[sid];
            logSuccess("MCP", "SessÃ£o encerrada", { session_id: sid });
          }
        };

        const server = createMcpServer(mcpDeps);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logError("MCP", "Erro no POST /mcp", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  const mcpGetHandler = async (req, res) => {
    if (!(await requireMcpAuth(req, res))) return;
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    try {
      await transports[sessionId].handleRequest(req, res);
    } catch (error) {
      logError("MCP", "Erro no GET /mcp", error);
      if (!res.headersSent) res.status(500).send("Internal server error");
    }
  };

  const mcpDeleteHandler = async (req, res) => {
    if (!(await requireMcpAuth(req, res))) return;
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    try {
      await transports[sessionId].handleRequest(req, res);
    } catch (error) {
      logError("MCP", "Erro no DELETE /mcp", error);
      if (!res.headersSent) res.status(500).send("Error processing session termination");
    }
  };

  app.post("/mcp", mcpPostHandler);
  app.get("/mcp", mcpGetHandler);
  app.delete("/mcp", mcpDeleteHandler);

  return {
    closeAll: async () => {
      for (const sid of Object.keys(transports)) {
        try {
          await transports[sid].close();
        } catch {
          /* ignore */
        }
        delete transports[sid];
      }
    },
  };
}
