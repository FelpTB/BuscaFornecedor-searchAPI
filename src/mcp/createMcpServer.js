import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchTextInputShape } from "../schemas/searchText.js";
import { createSearchId } from "../middleware/auth.js";

/**
 * MCP Server — tools espelham REST (mesmo searchService).
 * @param {{ executeSearchByText: Function, getPublicConfig: Function }} deps
 */
export function createMcpServer(deps) {
  const { executeSearchByText, getPublicConfig } = deps;

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
        const result = await executeSearchByText(args || {}, {
          debug: args?.debug === true,
          rerank: args?.rerank === true,
          searchId,
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

  return server;
}
