/**
 * Helpers para BM25 / sparse: termos exatos + merge na query léxica.
 */

/**
 * Normaliza exact_terms (string | string[]) → lista de termos não vazios.
 * @param {unknown} input
 * @returns {string[]}
 */
export function normalizeExactTerms(input) {
  if (input == null) return [];
  const list = Array.isArray(input) ? input : [input];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Extrai termos entre aspas do texto do usuário (", ', «», “”).
 * Também captura padrão "termo exato: X" / "exato: X".
 * @param {string} text
 * @returns {string[]}
 */
export function extractExactTermsFromText(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  const found = [];
  const seen = new Set();

  const push = (raw) => {
    const t = String(raw || "").trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(t);
  };

  const quoteRe = /"([^"\n]{1,120})"|'([^'\n]{1,120})'|«([^»\n]{1,120})»|“([^”\n]{1,120})”/g;
  let m;
  while ((m = quoteRe.exec(text)) !== null) {
    push(m[1] || m[2] || m[3] || m[4]);
  }

  const labeled = text.match(
    /(?:termo\s+exato|busca\s+exata|exato)\s*[=:]\s*["']?([^"'.\n,]{2,80})["']?/i,
  );
  if (labeled?.[1]) push(labeled[1]);

  return found;
}

/**
 * Une base BM25 + termos exatos (exatos primeiro; sem duplicar tokens case-insensitive).
 * @param {string|null|undefined} baseQuery
 * @param {string[]|string|null|undefined} exactTerms
 * @returns {string}
 */
export function mergeBm25Query(baseQuery, exactTerms) {
  const exact = normalizeExactTerms(exactTerms);
  const base = typeof baseQuery === "string" ? baseQuery.trim() : "";
  if (!exact.length) return base;
  if (!base) return exact.join(" ");

  const baseLower = ` ${base.toLowerCase()} `;
  const missing = exact.filter((t) => !baseLower.includes(` ${t.toLowerCase()} `));
  if (!missing.length) return base;
  return `${missing.join(" ")} ${base}`.trim();
}

/**
 * Resolve lista de termos exatos a partir de body/options + texto livre.
 * @param {{ exact_terms?: unknown, exactTerms?: unknown, userQuery?: string, query?: string }} sources
 * @returns {string[]}
 */
export function resolveExactTerms(sources = {}) {
  const fromField = normalizeExactTerms(sources.exact_terms ?? sources.exactTerms);
  const fromText = extractExactTermsFromText(sources.userQuery || sources.query || "");
  return normalizeExactTerms([...fromField, ...fromText]);
}
