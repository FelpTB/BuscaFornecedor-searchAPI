import { z } from "zod";
import { LIMITS } from "../config/env.js";

/**
 * Schema compartilhado REST + MCP para POST /search/text e tool search_text.
 * Regras de domínio (soma de pesos, allowlist de filtros) permanecem no searchService.
 */

export const filterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

/** Shape Zod para registerTool (MCP SDK). */
export const searchTextInputShape = {
  query: z
    .string()
    .min(1)
    .describe("Texto principal a vetorizar e buscar (obrigatório)"),
  queries: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Texto por dimensão (ex.: { produto: '...', servico: '...' }). Dimensões omitidas usam query.",
    ),
  weights: z
    .record(z.string(), z.number())
    .optional()
    .describe(
      "Pesos por dimensão (+ bm25 se híbrido). Soma deve ser 1.0. Se omitido, pesos iguais.",
    ),
  filter: z
    .record(z.string(), filterValueSchema)
    .optional()
    .describe(
      'Filtro positivo. Keyword: uf, cidade, modelo_negocio, nome_empresa, cnpj. Full-text: descricao, endereco, publico, site, email, certificacoes. Ex.: { "uf": "SP" } ou { "uf": ["SP","RJ"] }',
    ),
  filter_not: z
    .record(z.string(), filterValueSchema)
    .optional()
    .describe(
      'Filtro negativo (exclusão). Mesmas chaves de filter. Ex.: { "descricao": "combustível" }',
    ),
  bm25_query: z
    .string()
    .optional()
    .describe(
      "Termos BM25. Se omitido e BM25 estiver ativo, usa query. Envie bm25=false para desligar.",
    ),
  bm25: z
    .boolean()
    .optional()
    .describe("Se false, desliga BM25 mesmo com QDRANT_BM25_VECTOR_NAME configurado"),
  limit_per_vector: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.limitPerVectorMax)
    .optional()
    .describe(`Candidatos por vetor antes da fusão (default ${LIMITS.limitPerVectorDefault})`),
  final_limit: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.finalLimitMax)
    .optional()
    .describe(`Quantidade de resultados finais (default ${LIMITS.finalLimitDefault})`),
  rerank: z
    .boolean()
    .optional()
    .describe("Se true, reordena o top do pool com LLM"),
  query_text: z
    .string()
    .optional()
    .describe("Texto usado no rerank LLM; default = query"),
  embed_dimensions: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Dimensões do embedding OpenAI (só se a coleção usar dim reduzida)"),
  debug: z
    .boolean()
    .optional()
    .describe("Se true, inclui metadados de debug no resultado (parity com ?debug=1)"),
};

export const searchTextBodySchema = z.object(searchTextInputShape);

/**
 * Valida body REST/MCP. Retorna { success, data } ou { success: false, error }.
 * Aceita strings JSON em fields objeto (coerce leve para clientes n8n).
 */
export function parseSearchTextBody(raw) {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};

  for (const key of ["queries", "weights", "filter", "filter_not"]) {
    if (typeof body[key] === "string") {
      try {
        body[key] = JSON.parse(body[key]);
      } catch {
        return {
          success: false,
          error: `Campo '${key}' não é um JSON válido`,
        };
      }
    }
  }

  const result = searchTextBodySchema.safeParse(body);
  if (!result.success) {
    const msg = result.error.issues
      ?.map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return { success: false, error: msg || "Body inválido" };
  }
  return { success: true, data: result.data };
}
