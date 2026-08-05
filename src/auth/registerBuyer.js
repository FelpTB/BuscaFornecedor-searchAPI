/**
 * Onboarding: cria auth.users + usuario_comprador + api_key.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "../db/supabaseAdmin.js";
import {
  createCompradorProfile,
  getCompradorById,
  insertApiKey,
  listApiKeysForUser,
  revokeApiKey,
} from "../db/repositories/compradorRepo.js";
import { generateApiKey } from "./apiKeyHash.js";
import { AppError } from "../errors/AppError.js";

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
  const password =
    (typeof input.password === "string" && input.password.length >= 8
      ? input.password
      : `Tmp!${generateApiKey().plaintext.slice(0, 16)}`);

  const { data: created, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      nome,
      telefone: input.telefone || null,
      empresa_nome: input.empresa_nome || null,
      fonte: input.fonte || "Agente",
    },
  });

  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      throw AppError.badRequest("E-mail já cadastrado. Use issue_api_key com login ou outra chave.", {
        code: "EMAIL_EXISTS",
      });
    }
    throw new AppError(`Falha ao criar usuário: ${error.message}`, 502, {
      code: "AUTH_CREATE_FAILED",
    });
  }

  const userId = created.user.id;

  try {
    await createCompradorProfile({
      userId,
      nome,
      telefone: input.telefone || null,
      empresa_nome: input.empresa_nome || null,
      fonte: input.fonte || "Agente",
    });
  } catch (e) {
    // perfil pode já existir via trigger
    const existing = await getCompradorById(userId);
    if (!existing) throw e;
  }

  const key = generateApiKey();
  const stored = await insertApiKey({
    userId,
    name: input.key_name || "xray-agent",
    key_prefix: key.key_prefix,
    key_hash: key.key_hash,
  });

  const comprador = await getCompradorById(userId);

  return {
    user_id: userId,
    email,
    comprador: {
      nome: comprador?.nome ?? nome,
      tier_busca: comprador?.tier_busca ?? "normal",
      limite_buscas: comprador?.limite_buscas ?? 50,
      buscas_realizadas: comprador?.buscas_realizadas ?? 0,
    },
    api_key: {
      id: stored.id,
      name: stored.name,
      key_prefix: stored.key_prefix,
      /** plaintext — mostrar uma única vez */
      key: key.plaintext,
      warning: "Guarde esta chave agora. Ela não será exibida novamente.",
    },
  };
}

/**
 * Emite nova key para user já autenticado.
 */
export async function issueApiKeyForUser(userId, { name = "agent" } = {}) {
  if (!userId) throw AppError.unauthorized();
  const comprador = await getCompradorById(userId);
  if (!comprador) {
    throw AppError.forbidden("Usuário sem perfil comprador");
  }
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
  return { revoked: true, key_prefix: row.key_prefix };
}
