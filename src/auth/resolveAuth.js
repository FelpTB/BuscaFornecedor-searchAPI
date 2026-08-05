/**
 * Resolução de AuthContext — providers: off | api_key (env|supabase) | supabase_jwt.
 * Shape Entra-ready (provider field).
 */

import { getAuthModes, requireComprador } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { getSupabaseAdmin, isSupabaseConfigured } from "../db/supabaseAdmin.js";
import {
  findApiKeyByHash,
  getCompradorById,
  touchApiKeyLastUsed,
} from "../db/repositories/compradorRepo.js";
import { hashApiKey, looksLikeApiKey, looksLikeJwt } from "./apiKeyHash.js";

const cache = new Map();
const CACHE_TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS) || 120_000;

/**
 * @typedef {{
 *   authenticated: boolean,
 *   apiKeyId: string|null,
 *   userId: string|null,
 *   orgId: null,
 *   keyPrefix: string|null,
 *   provider: 'anonymous'|'api_key'|'supabase'|'entra'|'env_key',
 *   roles: string[],
 *   comprador: { nome: string|null, tierBusca: string, limiteBuscas: number, buscasRealizadas: number }|null
 * }} AuthContext
 */

/** @returns {AuthContext} */
export function anonymousAuth() {
  return {
    authenticated: false,
    apiKeyId: null,
    userId: null,
    orgId: null,
    keyPrefix: null,
    provider: "anonymous",
    roles: [],
    comprador: null,
  };
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, exp: Date.now() + CACHE_TTL_MS });
}

export function extractBearerOrApiKey(headers = {}) {
  const auth = headers?.authorization || headers?.Authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const x = headers?.["x-api-key"] || headers?.["X-Api-Key"];
  if (typeof x === "string" && x.trim()) return x.trim();
  return null;
}

function mapComprador(row) {
  if (!row) return null;
  return {
    nome: row.nome ?? null,
    tierBusca: row.tier_busca || "normal",
    limiteBuscas: Number(row.limite_buscas ?? 50),
    buscasRealizadas: Number(row.buscas_realizadas ?? 0),
  };
}

async function enrichWithComprador(ctx) {
  if (!ctx.userId) return ctx;
  try {
    const row = await getCompradorById(ctx.userId);
    if (row) {
      ctx.roles = Array.from(new Set([...(ctx.roles || []), "comprador"]));
      ctx.comprador = mapComprador(row);
    }
  } catch (e) {
    console.error("[auth] comprador enrich failed:", e.message);
  }
  return ctx;
}

function envKeys() {
  return (process.env.AUTH_API_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function resolveEnvApiKey(token) {
  const allowed = envKeys();
  if (!allowed.includes(token)) return null;
  const prefix = token.length > 8 ? `${token.slice(0, 8)}…` : "****";
  return {
    authenticated: true,
    apiKeyId: `env:${prefix}`,
    userId: process.env.AUTH_ENV_KEY_USER_ID?.trim() || null,
    orgId: null,
    keyPrefix: prefix,
    provider: "env_key",
    roles: [],
    comprador: null,
  };
}

async function resolveSupabaseApiKey(token) {
  if (!isSupabaseConfigured()) return null;
  const keyHash = hashApiKey(token);
  const cached = cacheGet(`ak:${keyHash}`);
  if (cached) return { ...cached };

  const row = await findApiKeyByHash(keyHash);
  if (!row || !row.active || row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;

  let ctx = {
    authenticated: true,
    apiKeyId: row.id,
    userId: row.user_id,
    orgId: null,
    keyPrefix: row.key_prefix,
    provider: "api_key",
    roles: [],
    comprador: null,
  };
  ctx = await enrichWithComprador(ctx);
  cacheSet(`ak:${keyHash}`, ctx);
  touchApiKeyLastUsed(row.id).catch(() => {});
  return ctx;
}

async function resolveSupabaseJwt(token) {
  if (!isSupabaseConfigured()) return null;
  const cached = cacheGet(`jwt:${token.slice(0, 24)}`);
  if (cached) return { ...cached };

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user?.id) return null;

  let ctx = {
    authenticated: true,
    apiKeyId: null,
    userId: data.user.id,
    orgId: null,
    keyPrefix: null,
    provider: "supabase",
    roles: [],
    comprador: null,
  };
  ctx = await enrichWithComprador(ctx);
  cacheSet(`jwt:${token.slice(0, 24)}`, ctx);
  return ctx;
}

/**
 * @param {Record<string, string|string[]|undefined>} headers
 * @param {{ optional?: boolean }} [opts] — se true (padrão no REST), ausência de credencial → anônimo
 * @returns {Promise<AuthContext>}
 */
export async function resolveAuthContext(headers = {}, opts = {}) {
  const optional = opts.optional !== false;
  const modes = getAuthModes();

  if (modes.length === 1 && modes[0] === "off") {
    return anonymousAuth();
  }

  const token = extractBearerOrApiKey(headers);

  // Sem credencial: anônimo (permite register/login/config). Busca usa assertCanSearch.
  if (!token) {
    if (optional || modes.includes("off")) return anonymousAuth();
    throw AppError.unauthorized("Informe Authorization: Bearer <token|key> ou X-Api-Key");
  }

  const tryOrder = [];
  if (looksLikeJwt(token) && (modes.includes("supabase_jwt") || modes.includes("api_key"))) {
    tryOrder.push("jwt");
  }
  if (modes.includes("api_key") || modes.includes("off")) {
    tryOrder.push("api_key");
  }
  if (!tryOrder.includes("jwt") && modes.includes("supabase_jwt")) {
    tryOrder.push("jwt");
  }

  for (const kind of tryOrder) {
    if (kind === "jwt") {
      const ctx = await resolveSupabaseJwt(token);
      if (ctx) return enforceCompradorGate(ctx);
    }
    if (kind === "api_key") {
      if (looksLikeApiKey(token) || !looksLikeJwt(token)) {
        const sbKey = await resolveSupabaseApiKey(token);
        if (sbKey) return enforceCompradorGate(sbKey);
        const envKey = await resolveEnvApiKey(token);
        if (envKey) {
          const enriched = envKey.userId
            ? await enrichWithComprador(envKey)
            : envKey;
          return enforceCompradorGate(enriched);
        }
      }
    }
  }

  throw AppError.unauthorized("Credencial inválida ou expirada");
}

function authModeRequiresCredential() {
  const modes = getAuthModes();
  return !(modes.length === 1 && modes[0] === "off");
}

function enforceCompradorGate(ctx) {
  if (!requireComprador()) return ctx;
  if (!ctx.authenticated) return ctx;
  // Gate applied at search endpoints, not on every request (config/register need to work)
  return ctx;
}

/** Gate explícito para rotas de busca. */
export function assertCanSearch(auth) {
  if (authModeRequiresCredential() && (!auth?.authenticated || !auth.userId)) {
    throw AppError.unauthorized(
      "Busca requer autenticação. Crie conta (register-buyer), faça login (login-buyer) ou envie Bearer/X-Api-Key.",
    );
  }
  if (!requireComprador()) return;
  if (!auth?.authenticated || !auth.userId) {
    throw AppError.unauthorized(
      "Busca requer autenticação. Crie uma conta/chave no X-Ray ou envie Bearer/X-Api-Key.",
    );
  }
  if (!auth.roles?.includes("comprador") || !auth.comprador) {
    throw AppError.forbidden(
      "Perfil de comprador obrigatório. Complete o cadastro (register_buyer) ou login_buyer antes de buscar.",
    );
  }
  const { buscasRealizadas, limiteBuscas } = auth.comprador;
  if (limiteBuscas != null && buscasRealizadas >= limiteBuscas) {
    throw AppError.forbidden(
      `Cota de buscas esgotada (${buscasRealizadas}/${limiteBuscas}).`,
    );
  }
}

export function publicAuthView(auth) {
  if (!auth) return null;
  return {
    authenticated: auth.authenticated,
    userId: auth.userId,
    provider: auth.provider,
    keyPrefix: auth.keyPrefix,
    roles: auth.roles,
    comprador: auth.comprador,
  };
}

/** Limpa cache (testes). */
export function _clearAuthCacheForTests() {
  cache.clear();
}
