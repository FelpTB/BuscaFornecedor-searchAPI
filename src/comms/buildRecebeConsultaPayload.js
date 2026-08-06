/**
 * Monta payloads de POST /v1/interno/orquestracao/recebe-consulta
 * a partir dos resultados da busca (espelha o nó n8n "Formata a Requisição").
 */

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    const s = typeof v === "string" ? v.trim() : v;
    if (s === "" || s === false) continue;
    return typeof v === "string" ? v.trim() : v;
  }
  return null;
}

function payloadOf(result) {
  if (!result || typeof result !== "object") return {};
  if (result.payload && typeof result.payload === "object") return result.payload;
  if (result.item && typeof result.item === "object") return result.item;
  return result;
}

function resolveCnpjBasico(row, raw) {
  const p = payloadOf(raw);
  const fromParts =
    p.cnpj_basico ||
    row?.cnpj_basico ||
    raw?.cnpj_basico ||
    null;
  if (fromParts && digitsOnly(fromParts).length >= 8) {
    return digitsOnly(fromParts).slice(0, 8);
  }
  const full = firstNonEmpty(p.cnpj, row?.cnpj, raw?.cnpj);
  const dig = digitsOnly(full);
  if (dig.length >= 8) return dig.slice(0, 8);
  return null;
}

function resolveOrdemDv(row, raw) {
  const p = payloadOf(raw);
  const ordem = firstNonEmpty(p.cnpj_ordem, row?.cnpj_ordem, raw?.cnpj_ordem);
  const dv = firstNonEmpty(p.cnpj_dv, row?.cnpj_dv, raw?.cnpj_dv);
  const o = ordem != null && /^\d{4}$/.test(String(ordem)) ? String(ordem) : null;
  const d = dv != null && /^\d{2}$/.test(String(dv)) ? String(dv) : null;
  if (o && d) return { cnpj_ordem: o, cnpj_dv: d };

  const full = digitsOnly(firstNonEmpty(p.cnpj, row?.cnpj, raw?.cnpj));
  if (full.length === 14) {
    return { cnpj_ordem: full.slice(8, 12), cnpj_dv: full.slice(12, 14) };
  }
  return {};
}

function resolveSegmento(params = {}) {
  return (
    firstNonEmpty(
      params.query,
      params.query_text,
      params.segmento,
      params.intent,
      params.queries?.produto,
      params.bm25_query,
    ) || null
  );
}

function resolveUf(params = {}) {
  const filter = params.filter && typeof params.filter === "object" ? params.filter : {};
  const uf = filter.uf ?? params.uf ?? params.uf_cidade ?? null;
  if (uf == null) return null;
  if (Array.isArray(uf)) {
    const parts = uf.map((x) => String(x).trim()).filter(Boolean);
    return parts.length ? parts : null;
  }
  const s = String(uf).trim();
  return s || null;
}

/**
 * @param {{
 *   search_id: string,
 *   enrichedResults?: object[],
 *   rawResults?: object[],
 *   params?: object,
 * }} input
 * @returns {object[]}
 */
export function buildRecebeConsultaBodies({
  search_id,
  enrichedResults = [],
  rawResults = [],
  params = {},
} = {}) {
  if (!search_id) return [];

  const segmento = resolveSegmento(params);
  const uf = resolveUf(params);
  const source =
    Array.isArray(enrichedResults) && enrichedResults.length
      ? enrichedResults
      : Array.isArray(rawResults)
        ? rawResults
        : [];

  const bodies = [];
  const seen = new Set();

  for (let i = 0; i < source.length; i += 1) {
    const row = source[i] || {};
    const raw = rawResults[i] || row;
    const p = payloadOf(raw);

    const cnpj_basico = resolveCnpjBasico(row, raw);
    if (!cnpj_basico || !/^\d{8}$/.test(cnpj_basico)) continue;

    const dedupeKey = cnpj_basico;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const ordemDv = resolveOrdemDv(row, raw);
    const nome_fantasia = firstNonEmpty(
      row.nome_empresa,
      p.nome_empresa,
      p.razao_social,
      p.nome,
      raw.nome_empresa,
      raw.razao_social,
    );
    const email_fornecedor = firstNonEmpty(p.email, raw.email, row.email);
    const telefone_fornecedor = firstNonEmpty(
      p.telefone,
      p.phone,
      raw.telefone,
      row.telefone,
    );

    const body = {
      id_consulta: search_id,
      cnpj_basico,
      ...ordemDv,
    };
    if (nome_fantasia) body.nome_fantasia = String(nome_fantasia).slice(0, 256);
    if (email_fornecedor) body.email_fornecedor = String(email_fornecedor);
    if (telefone_fornecedor) body.telefone_fornecedor = String(telefone_fornecedor);
    if (uf != null) body.uf = uf;
    if (segmento) body.segmento = String(segmento).slice(0, 256);

    bodies.push(body);
  }

  return bodies;
}
