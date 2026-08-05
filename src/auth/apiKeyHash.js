import { createHash, randomBytes } from "node:crypto";

const KEY_PREFIX_TAG = "sk_bf_";

export function hashApiKey(plaintext) {
  return createHash("sha256").update(String(plaintext), "utf8").digest("hex");
}

/** Gera key plaintext + metadados (mostrar 1x). */
export function generateApiKey() {
  const raw = randomBytes(24).toString("base64url");
  const plaintext = `${KEY_PREFIX_TAG}${raw}`;
  const key_prefix = plaintext.slice(0, 12);
  return {
    plaintext,
    key_prefix,
    key_hash: hashApiKey(plaintext),
  };
}

export function looksLikeJwt(token) {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function looksLikeApiKey(token) {
  if (typeof token !== "string") return false;
  const t = token.trim();
  return t.startsWith(KEY_PREFIX_TAG) || t.startsWith("sk_live_") || t.startsWith("sk_");
}
