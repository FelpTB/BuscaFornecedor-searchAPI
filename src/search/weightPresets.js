/**
 * Foco da busca (produto | servico | mista), pré-configurações de pesos
 * (escopo | publico_alvo | equilibrado) e tratamento de vetores sem texto
 * (query | ignore) para POST /search/text e tool search_text.
 */

export const SEARCH_FOCUS_VALUES = ["produto", "servico", "mista"];
export const WEIGHT_PRESET_VALUES = ["escopo", "publico_alvo", "equilibrado"];
export const EMPTY_VECTORS_VALUES = ["query", "ignore"];

/**
 * Pesos densos por pré-configuração (soma 1.0), em dimensões canônicas.
 * Com BM25 ativo, ensureBm25Weight injeta bm25 e reescala estes valores.
 * Calibrados por scripts/eval/weight-presets.mjs: público+cliente acima de ~0.4
 * passa a trazer empresas do público certo com escopo errado.
 */
export const WEIGHT_PRESETS = {
  escopo: { produto: 0.3, servico: 0.3, descricao: 0.3, publico: 0.05, cliente: 0.05 },
  publico_alvo: { produto: 0.2, servico: 0.2, descricao: 0.2, publico: 0.2, cliente: 0.2 },
  equilibrado: { produto: 0.25, servico: 0.25, descricao: 0.25, publico: 0.125, cliente: 0.125 },
};

const SEARCH_FOCUS_ALIASES = {
  produtos: "produto",
  servicos: "servico",
  misto: "mista",
  mixed: "mista",
  ambos: "mista",
};

const WEIGHT_PRESET_ALIASES = {
  publico: "publico_alvo",
  equilibrada: "equilibrado",
  balanceado: "equilibrado",
  balanceada: "equilibrado",
};

const EMPTY_VECTORS_ALIASES = {
  usar_query: "query",
  preencher: "query",
  fallback: "query",
  ignorar: "ignore",
  skip: "ignore",
  omit: "ignore",
};

function foldToken(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * @returns {string|undefined|null} valor canônico; undefined se ausente/vazio; null se inválido.
 */
function normalizeEnumValue(raw, allowed, aliases) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return null;
  const folded = foldToken(raw);
  if (!folded) return undefined;
  const value = aliases[folded] || folded;
  return allowed.includes(value) ? value : null;
}

export function normalizeSearchFocus(raw) {
  return normalizeEnumValue(raw, SEARCH_FOCUS_VALUES, SEARCH_FOCUS_ALIASES);
}

export function normalizeWeightPreset(raw) {
  return normalizeEnumValue(raw, WEIGHT_PRESET_VALUES, WEIGHT_PRESET_ALIASES);
}

export function normalizeEmptyVectors(raw) {
  return normalizeEnumValue(raw, EMPTY_VECTORS_VALUES, EMPTY_VECTORS_ALIASES);
}

/** Mapeia dimensões canônicas para as chaves reais da coleção (QDRANT_DIMENSION_KEYS). */
export function resolveCanonicalDims(dimensionKeys = []) {
  const find = (fragment) => dimensionKeys.find((k) => k.toLowerCase().includes(fragment)) || null;
  return {
    produto: find("produt"),
    servico: find("servic"),
    descricao: find("descric"),
    publico: find("public"),
    cliente: find("client"),
  };
}

function round6(n) {
  return Number(n.toFixed(6));
}

/** Corrige o resíduo de arredondamento na primeira dimensão com peso > 0. */
function fixRoundingResidual(weights, keys) {
  const sum = keys.reduce((a, k) => a + weights[k], 0);
  const delta = round6(1 - sum);
  if (delta === 0) return weights;
  const target = keys.find((k) => weights[k] > 0) ?? keys[0];
  weights[target] = round6(weights[target] + delta);
  return weights;
}

/**
 * Pesos densos (soma 1.0) para a pré-configuração, nas chaves reais da coleção.
 * Dimensões da coleção sem equivalente canônico recebem 0; o restante é renormalizado.
 */
export function buildPresetWeights(preset, dimensionKeys) {
  const table = WEIGHT_PRESETS[preset];
  if (!table || !Array.isArray(dimensionKeys) || dimensionKeys.length === 0) return null;
  const dims = resolveCanonicalDims(dimensionKeys);
  const out = Object.fromEntries(dimensionKeys.map((k) => [k, 0]));
  for (const [canonical, value] of Object.entries(table)) {
    const key = dims[canonical];
    if (key) out[key] += value;
  }
  const total = dimensionKeys.reduce((a, k) => a + out[k], 0);
  if (total <= 0) return null;
  for (const k of dimensionKeys) out[k] = round6(out[k] / total);
  return fixRoundingResidual(out, dimensionKeys);
}

/**
 * Para onde vai o peso da dimensão zerada pelo foco, conforme a pré-configuração:
 * - escopo (e pesos explícitos/padrão): tudo para a dimensão em foco
 * - equilibrado: dividido igualmente entre todas as dimensões densas restantes
 * - publico_alvo: dividido igualmente entre publico e cliente
 */
function focusTargets(preset, dims, dimensionKeys, onKey, offKey) {
  if (preset === "equilibrado") return dimensionKeys.filter((k) => k !== offKey);
  if (preset === "publico_alvo") {
    const audience = [dims.publico, dims.cliente].filter(Boolean);
    if (audience.length) return audience;
  }
  return [onKey];
}

/**
 * Aplica o foco: zera a dimensão oposta e redistribui o peso dela conforme o preset,
 * preservando a soma total (e o peso de bm25, se presente). "mista" não altera os pesos.
 * @param {string} [preset] só deve ser informado quando os pesos-base vieram do preset.
 * @returns {Record<string, number>|null} null se a coleção não tiver as dimensões produto/servico.
 */
export function applySearchFocus(weights, focus, dimensionKeys, preset) {
  if (!weights || !focus || focus === "mista") return weights;
  const dims = resolveCanonicalDims(dimensionKeys);
  const onKey = focus === "produto" ? dims.produto : dims.servico;
  const offKey = focus === "produto" ? dims.servico : dims.produto;
  if (!onKey || !offKey) return null;
  const out = { ...weights };
  const freed = Number(out[offKey] || 0);
  out[offKey] = 0;
  if (freed <= 0) return out;
  const targets = focusTargets(preset, dims, dimensionKeys, onKey, offKey);
  const share = round6(freed / targets.length);
  for (const k of targets) out[k] = round6(Number(out[k] || 0) + share);
  const residual = round6(freed - share * targets.length);
  if (residual !== 0) out[targets[0]] = round6(out[targets[0]] + residual);
  return out;
}

/**
 * Mantém peso só em keepKeys: as demais dimensões densas vão a 0 e o peso delas é
 * redistribuído proporcionalmente entre as mantidas (soma densa e bm25 preservados).
 * @returns {Record<string, number>|null} null se nenhuma dimensão mantida tiver peso > 0.
 */
export function restrictWeightsToDims(weights, keepKeys, dimensionKeys) {
  if (!weights) return null;
  const keep = new Set(keepKeys);
  const weightOf = (k) => Number(weights[k] || 0);
  const denseTotal = dimensionKeys.reduce((a, k) => a + weightOf(k), 0);
  const keptTotal = dimensionKeys.reduce((a, k) => a + (keep.has(k) ? weightOf(k) : 0), 0);
  if (keptTotal <= 0) return null;
  const out = { ...weights };
  for (const k of dimensionKeys) {
    out[k] = keep.has(k) ? round6((weightOf(k) * denseTotal) / keptTotal) : 0;
  }
  const delta = round6(denseTotal - dimensionKeys.reduce((a, k) => a + out[k], 0));
  if (delta !== 0) {
    const target = dimensionKeys.find((k) => out[k] > 0);
    out[target] = round6(out[target] + delta);
  }
  return out;
}
