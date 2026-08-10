import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchTextInputShape } from "../schemas/searchText.js";
import { createSearchId } from "../middleware/auth.js";
import { assertCanSearch } from "../auth/resolveAuth.js";
import { maybeEnqueueFromSearch } from "../telemetry/enqueue.js";
import {
  listConversas,
  getConversa,
  deleteConversa,
} from "../db/repositories/conversasRepo.js";
import { forgetSession } from "../xray/chatSessions.js";

/**
 * MCP Server — tools espelham REST (mesmo searchService).
 * @param {{
 *   executeSearchByText: Function,
 *   getPublicConfig: Function,
 *   getAuth?: () => object|null,
 * }} deps
 */
export function createMcpServer(deps) {
  const { executeSearchByText, getPublicConfig, getAuth } = deps;

  const server = new McpServer({
    name: "busca-fornecedor",
    version: "1.0.0",
  });

  server.registerTool(
    "get_config",
    {
      title: "Configuração da busca",
      description:
        "Retorna dimensões, filtros keyword/full-text, vetores, BM25, limites e modo de auth. " +
        "Chame antes de search_text para montar weights, filter ou filter_not corretamente.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const config = getPublicConfig();
      return {
        content: [{ type: "text", text: JSON.stringify(config, null, 2) }],
      };
    },
  );

  server.registerTool(
    "search_text",
    {
      title: "Busca de fornecedores por texto",
      description:
        "Busca empresas/fornecedores (Qdrant híbrido: densos + BM25 dual-path RRF). " +
        "Suporta weights, filter, filter_not, bm25, limites e rerank LLM. " +
        "Use get_config para chaves permitidas. Mesma lógica de POST /search/text.",
      inputSchema: searchTextInputShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      const searchId = createSearchId();
      try {
        const auth = typeof getAuth === "function" ? getAuth() : null;
        await assertCanSearch(auth);

        const result = await executeSearchByText(args || {}, {
          debug: args?.debug === true,
          rerank: args?.rerank === true,
          searchId,
        });

        maybeEnqueueFromSearch({
          auth,
          searchPayload: result,
          requestParams: args || {},
          source: "mcp",
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const status = err.status ?? err.statusCode ?? 500;
        const message = err.message || "Falha na busca";
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: message,
                status,
                code: err.code || "SEARCH_ERROR",
                search_id: searchId,
              }),
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "list_conversations",
    {
      title: "Listar conversas",
      description:
        "Lista conversas persistidas do usuário autenticado (mesmo que GET /conversations). Requer Bearer/API key.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("Default 30"),
        offset: z.number().int().min(0).optional().describe("Default 0"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const auth = typeof getAuth === "function" ? getAuth() : null;
      if (!auth?.userId) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Autenticação obrigatória para listar conversas",
                status: 401,
              }),
            },
          ],
        };
      }
      try {
        const out = await listConversas(auth.userId, {
          limit: args?.limit,
          offset: args?.offset,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: err.message || String(err),
                status: err.status || 500,
              }),
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "get_conversation",
    {
      title: "Obter conversa",
      description:
        "Retorna uma conversa + mensagens do usuário autenticado (mesmo que GET /conversations/:id).",
      inputSchema: {
        id: z.string().uuid().describe("UUID da conversa (session_id)"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const auth = typeof getAuth === "function" ? getAuth() : null;
      if (!auth?.userId) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Autenticação obrigatória",
                status: 401,
              }),
            },
          ],
        };
      }
      try {
        const row = await getConversa(auth.userId, args?.id);
        if (!row) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Conversa não encontrada", status: 404 }),
              },
            ],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(row, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: err.message || String(err),
                status: err.status || 500,
              }),
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "delete_conversation",
    {
      title: "Excluir conversa",
      description:
        "Exclui permanentemente uma conversa do usuário autenticado (cascade nas mensagens). Mesmo que DELETE /conversations/:id.",
      inputSchema: {
        id: z.string().uuid().describe("UUID da conversa (session_id)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const auth = typeof getAuth === "function" ? getAuth() : null;
      if (!auth?.userId) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Autenticação obrigatória",
                status: 401,
              }),
            },
          ],
        };
      }
      try {
        const out = await deleteConversa(auth.userId, args?.id);
        if (!out) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Conversa não encontrada", status: 404 }),
              },
            ],
          };
        }
        forgetSession(args?.id, { userId: auth.userId });
        return {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: err.message || String(err),
                status: err.status || 500,
              }),
            },
          ],
        };
      }
    },
  );

  return server;
}
