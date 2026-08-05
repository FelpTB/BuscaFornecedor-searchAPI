/**
 * Configuração centralizada + validação de boot.
 * Fonte única de defaults alinhados a .env.example.
 */

const DEFAULT_DIMENSION_KEYS = ["produto", "servico", "descricao", "publico", "cliente"];
const DEFAULT_VECTOR_NAMES = ["v_produto", "v_servico", "v_descricao", "v_publico", "v_cliente"];
const DEFAULT_PAYLOAD_KEYS = ["modelo_negocio", "cidade", "uf", "nome_empresa", "cnpj"];
const DEFAULT_PAYLOAD_KEYS_TEXT = [
  "descricao",
  "endereco",
  "publico",
  "site",
  "email",
  "certificacoes",
];

export const LIMITS = {
  limitPerVectorMax: 200,
  finalLimitMax: 100,
  limitPerVectorDefault: 50,
  finalLimitDefault: 20,
  bodyJsonBytes: "2mb",
};

/** @returns {string[]} modos: off | api_key | supabase_jwt (csv) */
export function getAuthModes() {
  const raw = (process.env.AUTH_MODE || "off").trim().toLowerCase();
  if (!raw || raw === "off") return ["off"];
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const normalized = parts.map((p) => {
    if (p === "apikey") return "api_key";
    return p;
  });
  return normalized.length ? normalized : ["off"];
}

/** Compat: modo "principal" para health/config. */
export function getAuthMode() {
  const modes = getAuthModes();
  if (modes.includes("off") && modes.length === 1) return "off";
  if (modes.includes("api_key")) return "api_key";
  if (modes.includes("supabase_jwt")) return "supabase_jwt";
  return modes[0] || "off";
}

export function requireComprador() {
  const v = (process.env.REQUIRE_COMPRADOR || "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function isTelemetryEnabled() {
  const m = (process.env.TELEMETRY_MODE || "inline").trim().toLowerCase();
  return m !== "off";
}

function splitCsv(envValue, fallback) {
  if (envValue && typeof envValue === "string") {
    const keys = envValue.split(",").map((s) => s.trim()).filter(Boolean);
    if (keys.length > 0) return keys;
  }
  return [...fallback];
}

export function getDimensionKeys() {
  return splitCsv(process.env.QDRANT_DIMENSION_KEYS, DEFAULT_DIMENSION_KEYS);
}

export function getVectorNamesMap() {
  const dimensionKeys = getDimensionKeys();
  const names = splitCsv(process.env.QDRANT_VECTOR_NAMES, DEFAULT_VECTOR_NAMES);
  if (names.length === dimensionKeys.length) {
    const map = {};
    dimensionKeys.forEach((key, i) => {
      map[key] = names[i];
    });
    return map;
  }
  const map = {};
  dimensionKeys.forEach((key, i) => {
    map[key] =
      DEFAULT_VECTOR_NAMES.length === dimensionKeys.length && DEFAULT_VECTOR_NAMES[i]
        ? DEFAULT_VECTOR_NAMES[i]
        : `v_${key}`;
  });
  return map;
}

export function getAllowedPayloadKeys() {
  return splitCsv(process.env.QDRANT_PAYLOAD_KEYS, DEFAULT_PAYLOAD_KEYS);
}

export function getFullTextPayloadKeys() {
  return splitCsv(process.env.QDRANT_PAYLOAD_KEYS_TEXT, DEFAULT_PAYLOAD_KEYS_TEXT);
}

export function getBm25PayloadKeys() {
  const env = process.env.QDRANT_BM25_PAYLOAD_KEYS;
  if (!env || typeof env !== "string") return [];
  return env.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Valida env obrigatório no boot. Não lança se SKIP_ENV_VALIDATION=1 (testes).
 * @returns {{ ok: true } | { ok: false, missing: string[] }}
 */
export function validateEnv({ soft = false } = {}) {
  if (process.env.SKIP_ENV_VALIDATION === "1") {
    return { ok: true, skipped: true };
  }

  const required = ["QDRANT_KEY", "CLUSTER_ENDPOINT", "COLLECTION_NAME", "OPENAI_API_KEY"];
  const missing = required.filter((k) => !process.env[k]?.trim());

  const dimensionKeys = getDimensionKeys();
  const vectorEnv = process.env.QDRANT_VECTOR_NAMES?.trim();
  const warnings = [];

  if (vectorEnv) {
    const names = vectorEnv.split(",").map((s) => s.trim()).filter(Boolean);
    if (names.length !== dimensionKeys.length) {
      warnings.push(
        `QDRANT_VECTOR_NAMES (${names.length}) deve ter o mesmo comprimento que QDRANT_DIMENSION_KEYS (${dimensionKeys.length})`,
      );
    }
  }

  if (getAuthMode() !== "off" && !process.env.AUTH_API_KEYS?.trim() && !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    warnings.push("AUTH_MODE ativo sem AUTH_API_KEYS nem Supabase — autenticação pode falhar");
  }
  if (requireComprador() && !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    warnings.push("REQUIRE_COMPRADOR=1 sem Supabase — buscas autenticadas falharão");
  }

  if (missing.length > 0) {
    if (!soft) {
      const err = new Error(
        `Variáveis de ambiente obrigatórias ausentes: ${missing.join(", ")}. Veja .env.example.`,
      );
      err.code = "ENV_VALIDATION";
      err.missing = missing;
      throw err;
    }
    return { ok: false, missing, warnings };
  }

  return { ok: true, missing: [], warnings, authMode: getAuthMode() };
}

export function getServerConfig() {
  return {
    port: Number(process.env.PORT) || 3000,
    host: process.env.HOST || "0.0.0.0",
    nodeEnv: process.env.NODE_ENV || "development",
    collectionName: process.env.COLLECTION_NAME?.trim() || null,
    authMode: getAuthMode(),
    authModes: getAuthModes(),
    requireComprador: requireComprador(),
    searchTimeoutMs: Number(process.env.SEARCH_TIMEOUT_MS) || 120_000,
  };
}
