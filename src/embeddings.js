import OpenAI from "openai";

const MODEL = "text-embedding-3-small";

let client = null;

function getClient() {
  if (!client) {
    const key = process.env.OPENAI_API_KEY;
    if (!key || typeof key !== "string" || !key.trim()) {
      throw new Error("OPENAI_API_KEY não configurado");
    }
    client = new OpenAI({ apiKey: key.trim() });
  }
  return client;
}

/**
 * Gera embedding de um único texto (query de busca).
 * @param {string} text
 * @param {number} [dimensions]
 * @returns {Promise<number[]>}
 */
export async function embedQueryText(text, dimensions) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error("Texto da query vazio");
  const openai = getClient();
  const request = { model: MODEL, input: [trimmed] };
  if (Number.isInteger(dimensions) && dimensions > 0) request.dimensions = dimensions;
  const response = await openai.embeddings.create(request);
  const embedding = response.data?.[0]?.embedding;
  if (!embedding?.length) throw new Error("OpenAI não retornou embedding para a query");
  return embedding;
}
