import { randomUUID } from "node:crypto";
import { multiVectorSearch } from "./multiVectorSearch.js";
import { llmRerank } from "./llmRerank.js";
import { embedQueryText } from "./embeddings.js";
import { normalizeKeyword } from "./normalizeKeyword.js";
import { logSuccess } from "./logger.js";
import {
  LIMITS,
  getAuthMode,
  getAuthModes,
  requireComprador,
  getBm25PayloadKeys,
  getDimensionKeys,
  getVectorNamesMap,
  getAllowedPayloadKeys,
  getFullTextPayloadKeys,
} from "./config/env.js";
import { isSupabaseConfigured } from "./db/supabaseAdmin.js";
import { isPgPoolConfigured } from "./db/pgPool.js";
import { getTelemetryMode } from "./telemetry/enqueue.js";
import { getNotificacaoMode, isNotificacaoConfigured, getNotificacaoApiBase } from "./clients/notificacaoClient.js";
import { mergeBm25Query, resolveExactTerms, detectQuerySpecificity, stripBm25Weight } from "./search/bm25Query.js";

const COLLECTION_NAME = process.env.COLLECTION_NAME;
const ENDPOINT_SEARCH_TEXT = "POST /search/text";

/** Todas as chaves permitidas para filter/filter_not: keyword + full-text (sem duplicatas). */
function getAllowedFilterKeys() {
  const keyword = getAllowedPayloadKeys();
  const text = getFullTextPayloadKeys();
  const set = new Set([...keyword, ...text]);
  return [...set];
}

function clampLimit(value, fallback, max) {
  const n = value != null ? Number(value) : fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.trunc(n), max);
}

function normalizeWeights(weights, dimensionKeys, includeBm25 = false) {
  if (!weights || typeof weights !== "object" || !Array.isArray(dimensionKeys)) return null;
  const w = {};
  for (const dim of dimensionKeys) {
    const v = Number(weights[dim]);
    if (Number.isNaN(v)) return null;
    w[dim] = v;
  }
  if (includeBm25) {
    const v = Number(weights.bm25);
    if (Number.isNaN(v) || v < 0) return null;
    w.bm25 = v;
  }
  return w;
}

function sumWeights(w) {
  return Object.values(w).reduce((a, b) => a + b, 0);
}

function isValidVector(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.every((x) => typeof x === "number" && !Number.isNaN(x));
}

/**
 * Converte filtro simples { chave: valor | valor[] } em formato Qdrant.
 * Apenas chaves presentes em allowedKeys são aceitas.
 * Valores vazios ou só espaços (" ") são ignorados.
 *
 * Semântica:
 * - valor escalar → match: { value } (campo = valor).
 * - array de valores → should: [ match value, ... ] (campo = QUALQUER UM da lista, OR).
 *   Ex.: uf: ["RJ", "SP", "MG"] → empresas cuja uf é RJ OU SP OU MG.
 * - string com vírgulas é convertida em array: uf: "SP,RJ" → ["SP", "RJ"] (OR).
 * - Várias chaves no filter → must: [ cond1, cond2 ] (AND entre chaves).
 *
 * Usamos "should" + vários "match value" em vez de "match.any" para máxima compatibilidade com o Qdrant.
 */
function isFilterValueEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

/** Normaliza valor do filtro: string "SP,RJ" vira array ["SP", "RJ"] para tratar como OR. */
function normalizeFilterValue(value) {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.includes(",")) {
    const arr = value.split(",").map((s) => s.trim()).filter((s) => s !== "");
    return arr.length === 0 ? null : arr.length === 1 ? arr[0] : arr;
  }
  return value;
}

/** Chaves de payload cujos valores são normalizados (maiúsculas, sem acentos) no filtro. modelo_negocio fica como recebido. */
const FILTER_KEYS_NORMALIZE = ["cidade", "uf"];

/**
 * Constrói o filtro Qdrant.
 * - Chaves em fullTextKeys → match.text (full-text no Qdrant); valor string ou array unido por espaço.
 * - Chaves em keywordKeys → match.value / match.any (keyword).
 */
function buildQdrantFilter(payloadFilter, keywordKeys, fullTextKeys = []) {
  if (!payloadFilter || typeof payloadFilter !== "object") return null;
  const must = [];
  for (const [key, value] of Object.entries(payloadFilter)) {
    const raw = value;
    if (raw === undefined || raw === null) continue;

    if (fullTextKeys.includes(key)) {
      const textQuery = Array.isArray(raw)
        ? raw.filter((v) => !isFilterValueEmpty(v)).map(String).join(" ").trim()
        : typeof raw === "string" ? raw.trim() : String(raw).trim();
      if (!textQuery) continue;
      must.push({ key, match: { text: textQuery } });
      continue;
    }

    if (!keywordKeys.includes(key)) continue;
    const valueNorm = normalizeFilterValue(raw);
    if (valueNorm === undefined || valueNorm === null) continue;
    const normalize = (v) =>
      typeof v === "string" && FILTER_KEYS_NORMALIZE.includes(key) ? normalizeKeyword(v) : v;
    if (Array.isArray(valueNorm)) {
      const values = valueNorm.filter(
        (v) =>
          !isFilterValueEmpty(v) &&
          (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      );
      if (values.length === 0) continue;
      const normalized = values.map((v) => normalize(v));
      if (normalized.length === 1) {
        must.push({ key, match: { value: normalized[0] } });
      } else {
        must.push({ key, match: { any: normalized } });
      }
    } else {
      if (isFilterValueEmpty(valueNorm)) continue;
      must.push({ key, match: { value: normalize(valueNorm) } });
    }
  }
  return must.length > 0 ? { must } : null;
}

/**
 * Constrói o filtro negativo Qdrant (must_not).
 * Chaves em fullTextKeys usam match.text; chaves em keywordKeys usam match.value / match.any.
 */
function buildQdrantFilterNot(payloadFilterNot, keywordKeys, fullTextKeys = []) {
  if (!payloadFilterNot || typeof payloadFilterNot !== "object") return null;
  const must_not = [];
  for (const [key, value] of Object.entries(payloadFilterNot)) {
    const raw = value;
    if (raw === undefined || raw === null) continue;

    if (fullTextKeys.includes(key)) {
      const textQuery = Array.isArray(raw)
        ? raw.filter((v) => !isFilterValueEmpty(v)).map(String).join(" ").trim()
        : typeof raw === "string" ? raw.trim() : String(raw).trim();
      if (!textQuery) continue;
      must_not.push({ key, match: { text: textQuery } });
      continue;
    }

    if (!keywordKeys.includes(key)) continue;
    const valueNorm = normalizeFilterValue(raw);
    if (valueNorm === undefined || valueNorm === null) continue;
    const normalize = (v) =>
      typeof v === "string" && FILTER_KEYS_NORMALIZE.includes(key) ? normalizeKeyword(v) : v;
    if (Array.isArray(valueNorm)) {
      const values = valueNorm.filter(
        (v) =>
          !isFilterValueEmpty(v) &&
          (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      );
      if (values.length === 0) continue;
      const normalized = values.map((v) => normalize(v));
      if (normalized.length === 1) {
        must_not.push({ key, match: { value: normalized[0] } });
      } else {
        must_not.push({ key, match: { any: normalized } });
      }
    } else {
      if (isFilterValueEmpty(valueNorm)) continue;
      must_not.push({ key, match: { value: normalize(valueNorm) } });
    }
  }
  return must_not.length > 0 ? { must_not } : null;
}

/** Mescla filtro positivo (must) com filtro negativo (must_not) para enviar ao Qdrant. */
function mergeQdrantFilter(positive, negative) {
  const hasPositive = positive && (positive.must?.length > 0 || positive.should?.length > 0);
  const hasNegative = negative && negative.must_not?.length > 0;
  if (!hasPositive && !hasNegative) return null;
  const out = {};
  if (hasPositive) {
    if (positive.must?.length) out.must = positive.must;
    if (positive.should?.length) out.should = positive.should;
  }
  if (hasNegative) out.must_not = negative.must_not;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Predicados de exclusão para pós-processamento: o Qdrant pode não aplicar must_not com match.text.
 * Retorna array de funções (payload) => true se o ponto deve ser excluído.
 * Full-text: termos são verificados em TODOS os campos full-text do payload (descricao, endereco, publico, etc.).
 * Keyword: cada chave aplica apenas ao seu campo (match exato).
 */
function buildFilterNotPredicates(payloadFilterNot, keywordKeys, fullTextKeys = []) {
  if (!payloadFilterNot || typeof payloadFilterNot !== "object") return [];
  const predicates = [];
  const allFullTextTerms = new Set();

  for (const [key, value] of Object.entries(payloadFilterNot)) {
    const raw = value;
    if (raw === undefined || raw === null || isFilterValueEmpty(raw)) continue;

    if (fullTextKeys.includes(key)) {
      const textQuery = Array.isArray(raw)
        ? raw.filter((v) => !isFilterValueEmpty(v)).map(String).join(" ").trim()
        : typeof raw === "string" ? raw.trim() : String(raw).trim();
      if (!textQuery) continue;
      textQuery.split(/\s+/).filter(Boolean).forEach((t) => allFullTextTerms.add(t.toLowerCase()));
      continue;
    }

    if (!keywordKeys.includes(key)) continue;
    const valueNorm = normalizeFilterValue(raw);
    if (valueNorm === undefined || valueNorm === null) continue;
    const normalize = (v) =>
      typeof v === "string" && FILTER_KEYS_NORMALIZE.includes(key) ? normalizeKeyword(v) : (v != null ? String(v).trim() : "");
    const values = Array.isArray(valueNorm)
      ? valueNorm.filter(
          (v) =>
            !isFilterValueEmpty(v) &&
            (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
        ).map(normalize)
      : [normalize(valueNorm)];
    if (values.length === 0) continue;
    const valueSet = new Set(values);
    predicates.push((payload) => {
      const pv = payload?.[key];
      const norm = normalize(pv);
      return valueSet.has(norm);
    });
  }

  if (allFullTextTerms.size > 0 && fullTextKeys.length > 0) {
    const terms = [...allFullTextTerms];
    predicates.push((payload) => {
      for (const key of fullTextKeys) {
        const text = String(payload?.[key] ?? "").toLowerCase();
        if (terms.some((term) => text.includes(term))) return true;
      }
      return false;
    });
  }

  return predicates;
}
function validateSearchBody(body) {
  if (!body || typeof body !== "object")
    return { status: 400, message: "Request body inválido" };

  const { vectors, weights, limit_per_vector, final_limit, filter, filter_not, bm25_query } = body;
  const dimensionKeys = getDimensionKeys();
  const useBm25 = bm25_query != null && bm25_query !== undefined;

  if (useBm25) {
    if (typeof bm25_query !== "string")
      return { status: 400, message: "Campo 'bm25_query' deve ser uma string" };
    const bm25VectorName = process.env.QDRANT_BM25_VECTOR_NAME?.trim();
    if (!bm25VectorName)
      return { status: 400, message: "Para usar BM25 configure QDRANT_BM25_VECTOR_NAME no ambiente (nome do vetor esparso da coleção)" };
  }
  const allowedFilterKeys = getAllowedFilterKeys();
  if (filter != null && filter !== undefined) {
    if (typeof filter !== "object" || Array.isArray(filter))
      return { status: 400, message: "Campo 'filter' deve ser um objeto" };
    if (allowedFilterKeys.length === 0)
      return { status: 400, message: "Configure QDRANT_PAYLOAD_KEYS e/ou QDRANT_PAYLOAD_KEYS_TEXT no ambiente para usar filtros" };
    const invalidKeys = Object.keys(filter).filter((k) => !allowedFilterKeys.includes(k));
    if (invalidKeys.length > 0)
      return { status: 400, message: `Chaves de filtro não permitidas: ${invalidKeys.join(", ")}. Permitidas: ${allowedFilterKeys.join(", ")}` };
  }
  if (filter_not != null && filter_not !== undefined) {
    if (typeof filter_not !== "object" || Array.isArray(filter_not))
      return { status: 400, message: "Campo 'filter_not' deve ser um objeto" };
    if (allowedFilterKeys.length === 0)
      return { status: 400, message: "Configure QDRANT_PAYLOAD_KEYS e/ou QDRANT_PAYLOAD_KEYS_TEXT no ambiente para usar filtros negativos (filter_not)" };
    const invalidKeys = Object.keys(filter_not).filter((k) => !allowedFilterKeys.includes(k));
    if (invalidKeys.length > 0)
      return { status: 400, message: `Chaves de filter_not não permitidas: ${invalidKeys.join(", ")}. Permitidas: ${allowedFilterKeys.join(", ")}` };
  }

  if (!vectors || typeof vectors !== "object")
    return { status: 400, message: "Campo 'vectors' é obrigatório" };

  for (const dim of dimensionKeys) {
    if (!(dim in vectors))
      return { status: 400, message: `Vetor ausente: '${dim}'` };
    if (!isValidVector(vectors[dim]))
      return { status: 400, message: `Vetor '${dim}' inválido ou dimensões incorretas` };
  }

  const firstDim = dimensionKeys[0];
  const dimLength = vectors[firstDim].length;
  for (let i = 1; i < dimensionKeys.length; i++) {
    if (vectors[dimensionKeys[i]].length !== dimLength)
      return { status: 400, message: "Dimensões dos vetores devem coincidir" };
  }

  const w = normalizeWeights(weights, dimensionKeys, useBm25);
  if (!w)
    return { status: 400, message: useBm25
      ? `Campo 'weights' inválido. Chaves esperadas: ${dimensionKeys.join(", ")}, bm25 (soma = 1.0)`
      : `Campo 'weights' inválido. Chaves esperadas: ${dimensionKeys.join(", ")} (soma = 1.0)` };
  const sum = sumWeights(w);
  if (Math.abs(sum - 1) > 1e-6)
    return { status: 400, message: "Soma dos pesos (densos + bm25 quando usado) deve ser 1.0" };

  const limitPerVector = Number(limit_per_vector);
  const finalLimit = Number(final_limit);
  if (!Number.isInteger(limitPerVector) || limitPerVector < 1)
    return { status: 400, message: "limit_per_vector deve ser um inteiro >= 1" };
  if (!Number.isInteger(finalLimit) || finalLimit < 1)
    return { status: 400, message: "final_limit deve ser um inteiro >= 1" };

  return null;
}

/**
 * Executa a busca multi-vetor e devolve o payload JSON (sem Express).
 * Usado por HTTP e pelo MCP.
 */
async function runMultiVectorSearch({
  body,
  collectionName,
  debugMode = false,
  rerankMode = false,
  includeCollectionInResponse = false,
}) {
  const { vectors, weights, limit_per_vector, final_limit, filter, filter_not, bm25_query, query_text } = body;
  const dimensionKeys = getDimensionKeys();
  const useBm25 = bm25_query != null && bm25_query !== "";
  const w = normalizeWeights(weights, dimensionKeys, useBm25);
  const keywordKeys = getAllowedPayloadKeys();
  const fullTextKeys = getFullTextPayloadKeys();
  const qdrantFilterPositive = buildQdrantFilter(filter, keywordKeys, fullTextKeys);
  const qdrantFilterNegative = buildQdrantFilterNot(filter_not, keywordKeys, fullTextKeys);
  const qdrantFilter = mergeQdrantFilter(qdrantFilterPositive, qdrantFilterNegative);
  const filterNotPredicates = buildFilterNotPredicates(filter_not, keywordKeys, fullTextKeys);

  const vectorsForSearch = {};
  for (const dim of dimensionKeys) vectorsForSearch[dim] = vectors[dim];

  try {
    const out = await multiVectorSearch({
      vectors: vectorsForSearch,
      weights: w,
      vectorNamesMap: getVectorNamesMap(),
      limitPerVector: limit_per_vector,
      finalLimit: final_limit,
      collectionName,
      filter: qdrantFilter,
      filterNotPredicates,
      bm25Query: typeof bm25_query === "string" ? bm25_query : null,
      returnDebugCounts: debugMode,
    });

    const searchResults = debugMode ? out.results : (out.results ?? out);
    const llmPool = out.llm_rerank_pool ?? [];
    const restPool = out.rest_after_pool ?? [];

    let finalResults = searchResults;
    let rerankInfo = null;

    if (rerankMode && llmPool.length > 0) {
      const queryForRerank = typeof query_text === "string" && query_text.trim()
        ? query_text.trim()
        : typeof bm25_query === "string" ? bm25_query.trim() : "";

      if (queryForRerank) {
        try {
          const { reranked, tokens_used, model } = await llmRerank(
            queryForRerank,
            typeof bm25_query === "string" ? bm25_query : null,
            llmPool
          );
          finalResults = [...reranked, ...restPool].slice(0, final_limit);
          rerankInfo = {
            enabled: true,
            model,
            tokens_used,
            pool_size: llmPool.length,
            query_used: queryForRerank,
          };
        } catch (rerankErr) {
          console.error("[rerank] LLM re-ranking falhou, usando ordem original:", rerankErr.message);
          rerankInfo = { enabled: true, error: rerankErr.message, fallback: "original_order" };
        }
      }
    }

    const formattedResults = finalResults.map((item, index) => ({
      posicao: index + 1,
      id: item.id,
      score_final: item.score_final,
      score_rrf: item.score_rrf,
      scores: item.scores,
      paths: item.paths,
      in_both: item.in_both,
      payload: item.payload,
    }));

    if (debugMode && out.debug) {
      out.debug.filter_sent = qdrantFilter;
      out.debug.weights_used = w;
      return {
        ...(includeCollectionInResponse ? { collection: collectionName } : {}),
        results: formattedResults,
        rerank: rerankInfo,
        debug: out.debug,
      };
    }

    const response = {
      ...(includeCollectionInResponse ? { collection: collectionName } : {}),
      results: formattedResults,
    };
    if (rerankInfo) response.rerank = rerankInfo;
    return response;
  } catch (err) {
    const status = err.status ?? err.statusCode ?? 500;
    const message =
      status === 400 && err.data?.status?.error
        ? err.data.status.error
        : "Erro no banco vetorial (busca Qdrant)";
    const wrapped = new Error(message);
    wrapped.status = status;
    wrapped.data = err.data;
    throw wrapped;
  }
}

function coerceJsonObjectField(raw, fieldName, { allowEmpty = true } = {}) {
  if (raw == null || raw === "") {
    return allowEmpty ? { value: undefined } : { error: { status: 400, message: `Campo '${fieldName}' é obrigatório` } };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return { value: raw };
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { value: parsed };
      }
      return { error: { status: 400, message: `Campo '${fieldName}' deve ser um objeto JSON` } };
    } catch {
      return { error: { status: 400, message: `Campo '${fieldName}' não é um JSON válido` } };
    }
  }
  return { error: { status: 400, message: `Campo '${fieldName}' deve ser um objeto` } };
}

/**
 * Vetoriza textos por dimensão com OpenAI.
 * - query: texto padrão replicado em todas as dimensões
 * - queries: opcional, sobrescreve o texto de dimensões específicas
 */

async function buildVectorsFromQueryText({ query, queries, dimensionKeys, embedDimensions }) {
  const perDimText = {};
  const uniqueTexts = new Map();

  for (const dim of dimensionKeys) {
    const override =
      queries && typeof queries[dim] === "string" && queries[dim].trim()
        ? queries[dim].trim()
        : null;
    const text = override || query;
    perDimText[dim] = text;
    if (!uniqueTexts.has(text)) uniqueTexts.set(text, null);
  }

  for (const text of uniqueTexts.keys()) {
    uniqueTexts.set(text, await embedQueryText(text, embedDimensions));
  }

  const vectors = {};
  for (const dim of dimensionKeys) {
    vectors[dim] = uniqueTexts.get(perDimText[dim]);
  }
  return { vectors, perDimText, embedding_dims: vectors[dimensionKeys[0]]?.length ?? 0 };
}

function buildEqualWeights(dimensionKeys, includeBm25 = false) {
  const n = dimensionKeys.length + (includeBm25 ? 1 : 0);
  const w = 1 / n;
  const weights = {};
  for (const dim of dimensionKeys) weights[dim] = w;
  if (includeBm25) weights.bm25 = w;
  return weights;
}

/** Se BM25 está ativo mas weights vieram sem chave bm25, injeta 0.20 e escala densos. */
function ensureBm25Weight(weights, dimensionKeys, bm25Share = 0.2) {
  if (!weights || typeof weights !== "object") return null;
  if (weights.bm25 != null && !Number.isNaN(Number(weights.bm25))) return weights;
  const share = Number.isFinite(bm25Share) && bm25Share > 0 && bm25Share < 1 ? bm25Share : 0.2;
  const denseSum = dimensionKeys.reduce((a, k) => a + Number(weights[k] || 0), 0);
  if (denseSum <= 0) return buildEqualWeights(dimensionKeys, true);
  const scale = (1 - share) / denseSum;
  const out = {};
  for (const k of dimensionKeys) {
    out[k] = Number((Number(weights[k] || 0) * scale).toFixed(6));
  }
  out.bm25 = share;
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  const delta = Number((1 - sum).toFixed(6));
  if (Math.abs(delta) > 0) {
    out[dimensionKeys[0]] = Number((out[dimensionKeys[0]] + delta).toFixed(6));
  }
  return out;
}

function getEmbedDimensionsForCollection(collection, body) {
  if (body?.embed_dimensions != null) {
    const n = Number(body.embed_dimensions);
    if (Number.isInteger(n) && n > 0) return n;
  }
  if (collection === "whatsapp_bf") {
    const n = Number(process.env.WHATSAPP_BF_EMBED_DIMENSIONS);
    if (Number.isInteger(n) && n > 0) return n;
    return 1536;
  }
  const global = Number(process.env.OPENAI_EMBED_DIMENSIONS);
  if (Number.isInteger(global) && global > 0) return global;
  return undefined;
}

async function executeSearchByText(rawBody = {}, options = {}) {
  if (!COLLECTION_NAME) {
    const err = new Error("COLLECTION_NAME não configurado no ambiente");
    err.status = 500;
    throw err;
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    const err = new Error("OPENAI_API_KEY não configurado; necessário para vetorizar a query");
    err.status = 503;
    throw err;
  }

  const body = rawBody && typeof rawBody === "object" ? rawBody : {};
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    const err = new Error("Campo 'query' é obrigatório (texto a buscar/vetorizar)");
    err.status = 400;
    throw err;
  }

  const queriesCoerced = coerceJsonObjectField(body.queries, "queries");
  if (queriesCoerced.error) {
    const err = new Error(queriesCoerced.error.message);
    err.status = queriesCoerced.error.status;
    throw err;
  }
  const weightsCoerced = coerceJsonObjectField(body.weights, "weights");
  if (weightsCoerced.error) {
    const err = new Error(weightsCoerced.error.message);
    err.status = weightsCoerced.error.status;
    throw err;
  }
  const filterCoerced = coerceJsonObjectField(body.filter, "filter");
  if (filterCoerced.error) {
    const err = new Error(filterCoerced.error.message);
    err.status = filterCoerced.error.status;
    throw err;
  }
  const filterNotCoerced = coerceJsonObjectField(body.filter_not, "filter_not");
  if (filterNotCoerced.error) {
    const err = new Error(filterNotCoerced.error.message);
    err.status = filterNotCoerced.error.status;
    throw err;
  }

  const dimensionKeys = getDimensionKeys();
  const queries = queriesCoerced.value;
  if (queries) {
    const invalidQueryKeys = Object.keys(queries).filter((k) => !dimensionKeys.includes(k));
    if (invalidQueryKeys.length > 0) {
      const err = new Error(
        `Chaves de queries não permitidas: ${invalidQueryKeys.join(", ")}. Permitidas: ${dimensionKeys.join(", ")}`,
      );
      err.status = 400;
      throw err;
    }
  }

  const bm25VectorName = process.env.QDRANT_BM25_VECTOR_NAME?.trim();
  const exactTerms = resolveExactTerms({
    exact_terms: body.exact_terms,
    userQuery: query,
  });
  const specificity = detectQuerySpecificity(query);
  const forceBm25 = exactTerms.length > 0 || specificity.specific;
  const bm25QueryProvided = typeof body.bm25_query === "string";
  const bm25QueryNonEmpty = bm25QueryProvided && body.bm25_query.trim() !== "";
  // exact_terms sempre ligam BM25 (ignoram bm25:false do cliente), se o vetor esparso existir
  const useBm25 =
    (body.bm25 !== false || forceBm25) &&
    Boolean(bm25VectorName) &&
    (bm25QueryProvided ? bm25QueryNonEmpty || forceBm25 : true);
  const bm25Base = useBm25
    ? (bm25QueryNonEmpty ? body.bm25_query.trim() : query)
    : "";
  const bm25_query = useBm25 ? mergeBm25Query(bm25Base, exactTerms) || undefined : undefined;

  let weights =
    weightsCoerced.value ??
    buildEqualWeights(dimensionKeys, Boolean(bm25_query));
  if (bm25_query) {
    weights = ensureBm25Weight(weights, dimensionKeys) || weights;
  } else {
    weights = stripBm25Weight(weights, dimensionKeys) || weights;
  }

  const limit_per_vector = clampLimit(
    body.limit_per_vector,
    LIMITS.limitPerVectorDefault,
    LIMITS.limitPerVectorMax,
  );
  const final_limit = clampLimit(
    body.final_limit,
    LIMITS.finalLimitDefault,
    LIMITS.finalLimitMax,
  );
  const embedDimensions = getEmbedDimensionsForCollection(COLLECTION_NAME, body);
  const start = Date.now();
  const debugMode = options.debug === true || body.debug === true;
  const rerankMode = options.rerank === true || body.rerank === true;
  const search_id = options.searchId || randomUUID();

  try {
    const { vectors, perDimText, embedding_dims } = await buildVectorsFromQueryText({
      query,
      queries,
      dimensionKeys,
      embedDimensions,
    });

    const searchBody = {
      ...body,
      query,
      query_text:
        typeof body.query_text === "string" && body.query_text.trim()
          ? body.query_text.trim()
          : query,
      vectors,
      weights,
      filter: filterCoerced.value,
      filter_not: filterNotCoerced.value,
      limit_per_vector,
      final_limit,
      bm25_query,
    };

    const validationError = validateSearchBody(searchBody);
    if (validationError) {
      const err = new Error(validationError.message);
      err.status = validationError.status;
      throw err;
    }

    logSuccess(ENDPOINT_SEARCH_TEXT, "Query vetorizada; iniciando busca", {
      search_id,
      collection: COLLECTION_NAME,
      embedding_dims,
      dimensions: dimensionKeys.length,
      duration_ms: Date.now() - start,
      query_preview: query.slice(0, 80),
      per_dim_override: Boolean(queries),
      has_filter: Boolean(filterCoerced.value),
      bm25: Boolean(bm25_query),
      rerank: rerankMode,
    });

    const payload = await runMultiVectorSearch({
      body: searchBody,
      collectionName: COLLECTION_NAME,
      debugMode,
      rerankMode,
    });

    return {
      search_id,
      ...payload,
      query,
      mode: "text",
      embedding_model: "text-embedding-3-small",
      embedding_dims,
      query_texts: perDimText,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    if (err.status) throw err;
    const status = err.statusCode ?? 500;
    const wrapped = new Error(err.message || "Falha ao vetorizar query ou buscar no Qdrant");
    wrapped.status = status;
    throw wrapped;
  }
}

function getPublicConfig() {
  const dimension_keys = getDimensionKeys();
  const payload_keys = getAllowedPayloadKeys();
  const payload_keys_full_text = getFullTextPayloadKeys();
  const vector_names = getVectorNamesMap();
  const bm25VectorName = process.env.QDRANT_BM25_VECTOR_NAME?.trim() || null;
  const bm25_payload_keys = getBm25PayloadKeys();
  const rrfK = Number(process.env.RRF_K);

  return {
    architecture: "dual-path-rrf-v5",
    dimension_keys,
    payload_keys,
    payload_keys_full_text: payload_keys_full_text.length > 0 ? payload_keys_full_text : null,
    vector_names,
    filter_not_supported: true,
    full_text_filter_supported: payload_keys_full_text.length > 0,
    bm25: {
      vector_name: bm25VectorName,
      payload_keys: bm25_payload_keys.length > 0 ? bm25_payload_keys : null,
      rrf_k: Number.isFinite(rrfK) ? rrfK : 20,
    },
    dual_path: {
      paths: ["A (BM25-First)", "B (Dense-First + BM25 Modifier)"],
      rrf_k: 10,
      path_top_n: Number(process.env.PATH_TOP_N) || 20,
      bm25_modifier: {
        boost: Number(process.env.BM25_MODIFIER_BOOST) || 1.0,
        absent_factor: Number(process.env.BM25_MODIFIER_ABSENT) || 0.85,
      },
    },
    llm_rerank: {
      enabled: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.LLM_RERANK_MODEL || "gpt-4o-mini",
      pool_size: Number(process.env.LLM_RERANK_POOL) || 20,
      usage: "Envie rerank=1 como query param ou rerank: true no body para ativar. Inclua query_text com a busca original.",
    },
    limits: {
      limit_per_vector_max: LIMITS.limitPerVectorMax,
      final_limit_max: LIMITS.finalLimitMax,
      limit_per_vector_default: LIMITS.limitPerVectorDefault,
      final_limit_default: LIMITS.finalLimitDefault,
    },
    auth: {
      mode: getAuthMode(),
      modes: getAuthModes(),
      required: getAuthMode() !== "off",
      require_comprador: requireComprador(),
      headers: ["Authorization: Bearer <jwt|sk_bf_…>", "X-Api-Key"],
      register: "POST /auth/register-buyer",
      login: "POST /auth/login-buyer",
      profile: "GET /auth/me",
      api_keys: "POST /auth/api-keys",
    },
    supabase: {
      configured: isSupabaseConfigured(),
      pg_pool: isPgPoolConfigured(),
      telemetry_mode: getTelemetryMode(),
    },
    notificacao: {
      mode: getNotificacaoMode(),
      configured: isNotificacaoConfigured(),
      base_url: getNotificacaoApiBase(),
      endpoint: "/v1/interno/orquestracao/recebe-consulta",
    },
    mcp: {
      endpoint: "/mcp",
      tools: ["get_config", "search_text", "list_conversations", "get_conversation", "delete_conversation"],
      auth: getAuthMode() !== "off",
    },
  };
}

export {
  COLLECTION_NAME,
  executeSearchByText,
  getPublicConfig,
  getDimensionKeys,
  getVectorNamesMap,
  getAllowedPayloadKeys,
  getFullTextPayloadKeys,
};
