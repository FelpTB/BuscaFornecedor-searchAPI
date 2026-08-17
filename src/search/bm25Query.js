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

const SPECIFICITY_STOP = new Set([
  "a",
  "as",
  "o",
  "os",
  "um",
  "uma",
  "uns",
  "umas",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "para",
  "pra",
  "com",
  "sem",
  "por",
  "e",
  "ou",
  "que",
  "se",
  "ao",
  "aos",
  "pode",
  "ser",
  "nivel",
  "nacional",
  "estadual",
  "municipal",
  "fornecedor",
  "fornecedores",
  "preciso",
  "necessito",
  "quero",
  "busca",
  "buscar",
]);

const DIGIT_PREV_SKIP = new Set([
  ...SPECIFICITY_STOP,
  "top",
  "ate",
  "cerca",
  "quase",
  "mais",
  "menos",
  "km",
  "metros",
  "raio",
  "ateh",
]);

/** Sufixos de modelo que vêm depois do número (iPhone 16 Pro Max, Galaxy S24 Ultra). */
const MODEL_TRAILING = new Set([
  "pro",
  "max",
  "plus",
  "ultra",
  "mini",
  "air",
  "lite",
  "prime",
  "fe",
  "neo",
  "se",
  "note",
]);

function foldPt(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function tokenizeWords(text) {
  return String(text || "")
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""))
    .filter(Boolean);
}

/**
 * Detecta pedido de SKU / marca / modelo / “especificamente”, mesmo sem aspas.
 * @param {string} text
 * @returns {{ specific: boolean, terms: string[], cues: string[] }}
 */
export function detectQuerySpecificity(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return { specific: false, terms: [], cues: [] };

  const folded = foldPt(raw);
  const cues = [];
  const terms = [];
  const seen = new Set();

  const pushTerm = (value) => {
    const t = String(value || "").replace(/\s+/g, " ").trim();
    if (!t || t.length < 2 || t.length > 80) return;
    const key = foldPt(t);
    if (seen.has(key) || SPECIFICITY_STOP.has(key)) return;
    seen.add(key);
    terms.push(t);
  };

  const cueChecks = [
    ["especificamente", /\bespecificamente\b/],
    ["especifico", /\bespecific[oa]s?\b/],
    ["termo_exato", /\btermo\s+exato\b/],
    ["busca_exata", /\bbusca\s+exata\b/],
    ["exatamente", /\bexatamente\s+(esse|este|o|a)\b/],
    ["desse_modelo", /\b(desse|deste|desse|este|esse)\s+modelo\b/],
    ["so_esse_modelo", /\bso\s+(esse|este|o)\s+modelo\b/],
    ["sku", /\bsku\b/],
    ["part_number", /\bpart\s*number\b/],
    ["referencia", /\breferencia\b/],
  ];
  for (const [name, re] of cueChecks) {
    if (re.test(folded)) cues.push(name);
  }

  const modeloRe =
    /\bmodelo\s+(?!de\s+neg[oó]cio|de\s+empresa|comercial)([^,.;!?]{2,80})/gi;
  let m;
  while ((m = modeloRe.exec(raw)) !== null) {
    let phrase = m[1] || "";
    phrase = phrase.split(
      /\b(?:especificamente|específicamente|espec[ií]fic[oa]s?|pode|nacional|estadual|somente|apenas)\b/i,
    )[0];
    phrase = phrase.replace(/[.,;:]+$/g, "").trim();
    const words = tokenizeWords(phrase).filter((w) => !SPECIFICITY_STOP.has(foldPt(w)));
    if (words.length) pushTerm(words.join(" "));
  }

  const marcaRe = /\bmarca\s+([a-z0-9][\w.\-]{1,40})/gi;
  while ((m = marcaRe.exec(raw)) !== null) {
    pushTerm(m[1]);
  }

  const beforeModelo = raw.match(/\b([a-z0-9][\w.\-]{1,30})\s+modelo\b/i);
  if (beforeModelo?.[1] && !SPECIFICITY_STOP.has(foldPt(beforeModelo[1]))) {
    pushTerm(beforeModelo[1]);
  }

  const words = tokenizeWords(raw);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!/\d/.test(w) || w.length > 24) continue;
    const prev = words[i - 1] || "";
    const prevFold = foldPt(prev);
    if (!prev || DIGIT_PREV_SKIP.has(prevFold) || !/[a-z]/i.test(prev)) continue;
    const prev2 = words[i - 2] || "";
    const prev2Fold = foldPt(prev2);
    const extras = [];
    for (let j = i + 1; j < words.length && extras.length < 3; j++) {
      if (!MODEL_TRAILING.has(foldPt(words[j]))) break;
      extras.push(words[j]);
    }
    const chunk = [
      prev2 && !DIGIT_PREV_SKIP.has(prev2Fold) && /[a-z]/i.test(prev2) ? prev2 : null,
      prev,
      w,
      ...extras,
    ]
      .filter(Boolean)
      .join(" ");
    pushTerm(chunk);
  }

  if (/\bmodelo\s+(?!de\s+neg[oó]cio|de\s+empresa|comercial)/i.test(raw) && terms.length) {
    if (!cues.includes("modelo")) cues.push("modelo");
  }
  if (/\bmarca\s+[a-z0-9]/i.test(raw) && !cues.includes("marca")) cues.push("marca");

  return {
    specific: cues.length > 0 || terms.length > 0,
    terms,
    cues,
  };
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
  const text = sources.userQuery || sources.query || "";
  const fromQuotes = extractExactTermsFromText(text);
  const fromSpec = detectQuerySpecificity(text).terms;
  return normalizeExactTerms([...fromField, ...fromQuotes, ...fromSpec]);
}
