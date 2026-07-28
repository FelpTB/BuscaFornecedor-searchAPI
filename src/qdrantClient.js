import { QdrantClient } from "@qdrant/js-client-rest";
import "dotenv/config";

let _client = null;

/**
 * Cliente Qdrant lazy (só instancia na primeira busca).
 * @returns {import('@qdrant/js-client-rest').QdrantClient}
 */
export function getQdrantClient() {
  if (_client) return _client;

  const url = process.env.CLUSTER_ENDPOINT;
  const apiKey = process.env.QDRANT_KEY;
  if (!url || !apiKey) {
    const hint =
      typeof process.env.RAILWAY_ENVIRONMENT !== "undefined"
        ? " Configure QDRANT_KEY, CLUSTER_ENDPOINT e COLLECTION_NAME em Railway → Variables."
        : " Defina-as no arquivo .env (local) ou nas variáveis de ambiente do provedor.";
    throw new Error("Variáveis CLUSTER_ENDPOINT e QDRANT_KEY são obrigatórias." + hint);
  }

  _client = new QdrantClient({
    url,
    apiKey,
    timeout: (Number(process.env.SEARCH_TIMEOUT_SECONDS) || 120) * 1000,
    checkCompatibility: false,
  });
  return _client;
}

const client = {
  get collections() {
    return getQdrantClient().collections;
  },
};

// Proxy para manter `import client from "./qdrantClient.js"` compatível com multiVectorSearch
export default new Proxy(
  {},
  {
    get(_t, prop) {
      const c = getQdrantClient();
      const val = c[prop];
      return typeof val === "function" ? val.bind(c) : val;
    },
  },
);
