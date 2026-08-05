/**
 * Repositórios Supabase — comprador, api_keys.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "../supabaseAdmin.js";
import { AppError } from "../../errors/AppError.js";

const SCHEMA = "busca_fornecedor";

function adminOrThrow() {
  const sb = getSupabaseAdmin();
  if (!sb) {
    throw AppError.serviceUnavailable(
      "Supabase não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  return sb;
}

export async function getCompradorById(userId) {
  if (!userId || !isSupabaseConfigured()) return null;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .schema(SCHEMA)
    .from("usuario_comprador")
    .select(
      "id, nome, telefone, empresa_nome, tier_busca, limite_buscas, buscas_realizadas, fonte",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`comprador lookup: ${error.message}`);
  return data;
}

export async function createCompradorProfile({
  userId,
  nome,
  telefone,
  empresa_nome,
  fonte = "Agente",
}) {
  const sb = adminOrThrow();
  const row = {
    id: userId,
    nome: nome || null,
    telefone: telefone || null,
    empresa_nome: empresa_nome || null,
    fonte,
    tier_busca: "normal",
    limite_buscas: 50,
    buscas_realizadas: 0,
  };
  const { data, error } = await sb.schema(SCHEMA).from("usuario_comprador").insert(row).select().single();
  if (error) {
    const err = new Error(`create comprador: ${error.message}`);
    err.code = error.code;
    throw err;
  }
  return data;
}

export async function findApiKeyByHash(keyHash) {
  if (!keyHash || !isSupabaseConfigured()) return null;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .schema(SCHEMA)
    .from("api_keys")
    .select("id, user_id, key_prefix, name, active, revoked_at, expires_at, scopes")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (error) {
    // tabela ainda não migrada
    if (String(error.message).includes("does not exist") || error.code === "42P01") {
      return null;
    }
    throw new Error(`api_keys lookup: ${error.message}`);
  }
  return data;
}

export async function insertApiKey({
  userId,
  name,
  key_prefix,
  key_hash,
  scopes = ["search"],
}) {
  const sb = adminOrThrow();
  const { data, error } = await sb
    .schema(SCHEMA)
    .from("api_keys")
    .insert({
      user_id: userId,
      name: name || "default",
      key_prefix,
      key_hash,
      scopes,
      active: true,
    })
    .select("id, key_prefix, name, created_at")
    .single();
  if (error) {
    const err = new Error(`insert api_key: ${error.message}`);
    err.code = error.code;
    throw err;
  }
  return data;
}

export async function touchApiKeyLastUsed(apiKeyId) {
  if (!apiKeyId || !isSupabaseConfigured()) return;
  const sb = getSupabaseAdmin();
  await sb
    .schema(SCHEMA)
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKeyId);
}

export async function revokeApiKey({ userId, keyPrefix }) {
  const sb = adminOrThrow();
  const { data, error } = await sb
    .schema(SCHEMA)
    .from("api_keys")
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("key_prefix", keyPrefix)
    .eq("active", true)
    .select("id, key_prefix")
    .maybeSingle();
  if (error) throw new Error(`revoke api_key: ${error.message}`);
  return data;
}

export async function listApiKeysForUser(userId) {
  if (!userId || !isSupabaseConfigured()) return [];
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .schema(SCHEMA)
    .from("api_keys")
    .select("id, name, key_prefix, active, created_at, last_used_at, revoked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`list api_keys: ${error.message}`);
  return data || [];
}
