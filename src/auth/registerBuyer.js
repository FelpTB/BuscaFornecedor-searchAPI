/**
 * Onboarding: cria auth.users + usuario_comprador + api_key.
 * Login: conta existente (email+senha) → emite nova api_key.
 */

import {
  getSupabaseAdmin,
  getSupabaseAuthClient,
  isSupabaseConfigured,
} from "../db/supabaseAdmin.js";
import {
  createCompradorProfile,
  getCompradorById,
  insertApiKey,
  listApiKeysForUser,
  revokeApiKey,
  countActiveApiKeys,
} from "../db/repositories/compradorRepo.js";
import { generateApiKey } from "./apiKeyHash.js";
import { AppError, isAppError } from "../errors/AppError.js";
import { mapSupabaseError } from "../db/mapSupabaseError.js";
import { loginMintApiKey, maxActiveApiKeys } from "../config/env.js";
import { canonicalizeFonte, limiteBuscasForFonte } from "./fonte.js";

function rethrowMapped(e) {
  if (isAppError(e)) throw e;
  throw mapSupabaseError(e);
}

async function assertUnderKeyCap(userId) {
  const max = maxActiveApiKeys();
  if (!max) return;
  const n = await countActiveApiKeys(userId);
  if (n >= max) {
    throw AppError.forbidden(
      `Limite de ${max} API keys ativas atingido. Revogue uma chave antes de emitir outra.`,
    );
  }
}

function sessionTokens(session) {
  if (!session) return {};
  return {
    access_token: session.access_token || null,
    refresh_token: session.refresh_token || null,
    expires_in: session.expires_in ?? null,
    expires_at: session.expires_at ?? null,
  };
}

function formatBuyerResult({ userId, email, comprador, stored, key, extra = {} }) {
  return {
    user_id: userId,
    email,
    comprador: {
      nome: comprador?.nome ?? null,
      tier_busca: comprador?.tier_busca ?? "normal",
      limite_buscas: comprador?.limite_buscas ?? limiteBuscasForFonte(comprador?.fonte),
      buscas_realizadas: comprador?.buscas_realizadas ?? 0,
      fonte: comprador?.fonte ?? null,
      acesso_agente: Boolean(comprador?.acesso_agente),
    },
    api_key: stored && key
      ? {
          id: stored.id,
          name: stored.name,
          key_prefix: stored.key_prefix,
          key: key.plaintext,
          warning: "Guarde esta chave agora. Ela não será exibida novamente.",
        }
      : null,
    ...extra,
  };
}

async function ensureCompradorProfile(user, { nome, telefone, empresa_nome, fonte } = {}) {
  const userId = user.id;
  let comprador = await getCompradorById(userId);
  if (comprador) return comprador;

  const meta = user.user_metadata || {};
  const resolvedNome =
    (typeof nome === "string" && nome.trim()) ||
    meta.nome ||
    meta.full_name ||
    meta.name ||
    (typeof user.email === "string" ? user.email.split("@")[0] : "Comprador");

  try {
    const fonteCanon = canonicalizeFonte(fonte || meta.fonte || "Login", "Login");
    await createCompradorProfile({
      userId,
      nome: resolvedNome,
      telefone: telefone || meta.telefone || null,
      empresa_nome: empresa_nome || meta.empresa_nome || null,
      fonte: fonteCanon,
      limite_buscas: limiteBuscasForFonte(fonteCanon),
    });
  } catch (e) {
    comprador = await getCompradorById(userId);
    if (!comprador) throw e;
    return comprador;
  }
  return getCompradorById(userId);
}

/**
 * @param {{
 *   email: string,
 *   nome?: string,
 *   telefone?: string,
 *   empresa_nome?: string,
 *   password?: string,
 *   fonte?: string,
 *   key_name?: string,
 * }} input
 */
export async function registerBuyer(input = {}) {
  if (!isSupabaseConfigured()) {
    throw AppError.serviceUnavailable(
      "Supabase não configurado — defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    throw AppError.badRequest("email válido é obrigatório");
  }

  const nome = typeof input.nome === "string" ? input.nome.trim() : "";
  if (!nome) throw AppError.badRequest("nome é obrigatório");

  const sb = getSupabaseAdmin();
  const passwordProvided =
    typeof input.password === "string" && input.password.length >= 8;
  const password = passwordProvided
    ? input.password
    : `Tmp!${generateApiKey().plaintext.slice(0, 16)}`;
  const fonte = canonicalizeFonte(input.fonte || "Agente", "Agente");

  const { data: created, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      nome,
      telefone: input.telefone || null,
      empresa_nome: input.empresa_nome || null,
      fonte,
    },
  });

  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      throw AppError.badRequest(
        "E-mail já cadastrado. Use POST /auth/login-buyer com email e senha para obter uma API key.",
        { code: "EMAIL_EXISTS", hint: "login-buyer" },
      );
    }
    throw new AppError(`Falha ao criar usuário: ${error.message}`, 502, {
      code: "AUTH_CREATE_FAILED",
    });
  }

  const userId = created.user.id;
  try {
    const comprador = await ensureCompradorProfile(created.user, {
      nome,
      telefone: input.telefone,
      empresa_nome: input.empresa_nome,
      fonte,
    });

    await assertUnderKeyCap(userId);
    const key = generateApiKey();
    const stored = await insertApiKey({
      userId,
      name: input.key_name || "xray-agent",
      key_prefix: key.key_prefix,
      key_hash: key.key_hash,
    });

    return formatBuyerResult({
      userId,
      email,
      comprador,
      stored,
      key,
      extra: passwordProvided
        ? {}
        : {
            temporary_password: password,
            password_note:
              "Senha temporária gerada — guarde para login futuro (login-buyer). Prefira informar password no cadastro.",
          },
    });
  } catch (e) {
    rethrowMapped(e);
  }
}

/**
 * Conta existente: valida email+senha no Supabase Auth e emite nova API key.
 * Cria perfil comprador se o user Auth existir sem linha em usuario_comprador.
 *
 * @param {{
 *   email: string,
 *   password: string,
 *   key_name?: string,
 *   fonte?: string,
 * }} input
 */
export async function loginBuyer(input = {}) {
  if (!isSupabaseConfigured()) {
    throw AppError.serviceUnavailable(
      "Supabase não configurado — defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!email || !email.includes("@")) {
    throw AppError.badRequest("email válido é obrigatório");
  }
  if (!password || password.length < 6) {
    throw AppError.badRequest("password é obrigatório");
  }

  const authClient = getSupabaseAuthClient();
  if (!authClient) {
    throw AppError.serviceUnavailable(
      "Login indisponível — defina SUPABASE_ANON_KEY (recomendado) ou SERVICE_ROLE",
    );
  }

  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data?.user) {
    throw AppError.unauthorized(
      error?.message?.includes("Invalid login")
        ? "E-mail ou senha inválidos"
        : error?.message || "Falha no login",
    );
  }

  const user = data.user;
  try {
    const comprador = await ensureCompradorProfile(user, {
      fonte: canonicalizeFonte(input.fonte || "Login", "Login"),
    });
    if (!comprador) {
      throw AppError.forbidden("Não foi possível criar/obter perfil comprador");
    }

    if (!loginMintApiKey()) {
      return {
        user_id: user.id,
        email: user.email || email,
        comprador: {
          nome: comprador?.nome ?? null,
          tier_busca: comprador?.tier_busca ?? "normal",
          limite_buscas: comprador?.limite_buscas ?? limiteBuscasForFonte(comprador?.fonte),
          buscas_realizadas: comprador?.buscas_realizadas ?? 0,
          fonte: comprador?.fonte ?? null,
          acesso_agente: Boolean(comprador?.acesso_agente),
        },
        api_key: null,
        ...sessionTokens(data.session),
        note:
          "Login OK sem nova API key (LOGIN_MINT_API_KEY=0). Use access_token (JWT) + refresh_token, ou POST /auth/api-keys autenticado.",
      };
    }

    await assertUnderKeyCap(user.id);
    const key = generateApiKey();
    const stored = await insertApiKey({
      userId: user.id,
      name: input.key_name || "login",
      key_prefix: key.key_prefix,
      key_hash: key.key_hash,
    });

    return formatBuyerResult({
      userId: user.id,
      email: user.email || email,
      comprador,
      stored,
      key,
      extra: {
        ...sessionTokens(data.session),
        note: "API key emitida para conta existente. O JWT (access_token + refresh_token) também autentica se AUTH_MODE incluir supabase_jwt.",
      },
    });
  } catch (e) {
    rethrowMapped(e);
  }
}

/**
 * Troca refresh_token do Supabase por um novo par access/refresh.
 * Não emite API key.
 */
export async function refreshBuyerSession(refreshToken) {
  if (!isSupabaseConfigured()) {
    throw AppError.serviceUnavailable(
      "Supabase não configurado — defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  const token = typeof refreshToken === "string" ? refreshToken.trim() : "";
  if (!token) throw AppError.unauthorized("refresh_token é obrigatório");

  const authClient = getSupabaseAuthClient();
  if (!authClient) {
    throw AppError.serviceUnavailable("Refresh indisponível — defina SUPABASE_ANON_KEY");
  }

  const { data, error } = await authClient.auth.refreshSession({ refresh_token: token });
  if (error || !data?.session?.access_token) {
    throw AppError.unauthorized("Sessão expirada. Entre novamente.");
  }

  return {
    user_id: data.user?.id || data.session.user?.id || null,
    ...sessionTokens(data.session),
  };
}

export async function issueApiKeyForUser(userId, { name = "agent" } = {}) {
  if (!userId) throw AppError.unauthorized();
  try {
    const comprador = await getCompradorById(userId);
    if (!comprador) {
      throw AppError.forbidden("Usuário sem perfil comprador");
    }
    await assertUnderKeyCap(userId);
    const key = generateApiKey();
    const stored = await insertApiKey({
      userId,
      name,
      key_prefix: key.key_prefix,
      key_hash: key.key_hash,
    });
    return {
      id: stored.id,
      name: stored.name,
      key_prefix: stored.key_prefix,
      key: key.plaintext,
      warning: "Guarde esta chave agora. Ela não será exibida novamente.",
    };
  } catch (e) {
    rethrowMapped(e);
  }
}

export async function getProfile(userId) {
  if (!userId) throw AppError.unauthorized();
  const comprador = await getCompradorById(userId);
  const keys = await listApiKeysForUser(userId);
  return {
    user_id: userId,
    comprador: comprador
      ? {
          nome: comprador.nome,
          telefone: comprador.telefone,
          empresa_nome: comprador.empresa_nome,
          tier_busca: comprador.tier_busca,
          limite_buscas: comprador.limite_buscas,
          buscas_realizadas: comprador.buscas_realizadas,
          fonte: comprador.fonte,
          acesso_agente: Boolean(comprador.acesso_agente),
        }
      : null,
    api_keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      key_prefix: k.key_prefix,
      active: k.active,
      created_at: k.created_at,
      last_used_at: k.last_used_at,
      revoked_at: k.revoked_at,
    })),
  };
}

export async function revokeUserApiKey(userId, keyPrefix) {
  if (!userId) throw AppError.unauthorized();
  if (!keyPrefix) throw AppError.badRequest("key_prefix obrigatório");
  const row = await revokeApiKey({ userId, keyPrefix });
  if (!row) throw AppError.badRequest("Chave não encontrada ou já revogada");
  const { invalidateAuthCacheForApiKeyId } = await import("./resolveAuth.js");
  invalidateAuthCacheForApiKeyId(row.id);
  return { revoked: true, key_prefix: row.key_prefix, id: row.id };
}
