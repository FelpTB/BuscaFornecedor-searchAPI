/**
 * Padronização de exibição de resultados de fornecedor (chat + X-Ray).
 *
 * Formato markdown esperado no chat:
 * N. **Nome**
 *    - **Local:** UF · Cidade
 *    - **Modelo de Negócio:** …
 *    - **Descrição:** …
 *    - **Site:** [dominio.com.br](https://…)
 *    - **Perfil:** [Perfil Nome](https://buscafornecedor.com.br/perfil/…)
 */

export const PERFIL_BASE_URL = "https://buscafornecedor.com.br/perfil";

/**
 * @param {unknown} value
 * @returns {string}
 */
export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Se o texto vier TODO EM CAPS, aplica title-case suave.
 * @param {string} s
 */
export function softTitleCase(s) {
  const t = String(s || "").trim();
  if (!t) return t;
  if (t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .replace(/(^|[\s'/.-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

/**
 * CNPJ básico (8 dígitos) para URL de perfil.
 * @param {object} payload
 * @returns {string|null}
 */
export function cnpjBasicoFromPayload(payload = {}) {
  const fromBasico = digitsOnly(payload.cnpj_basico);
  if (fromBasico.length >= 8) return fromBasico.slice(0, 8).padStart(8, "0");

  const fromCnpj = digitsOnly(payload.cnpj ?? payload.cnpj_completo ?? payload.CNPJ);
  if (fromCnpj.length >= 14) return fromCnpj.slice(0, 8);
  if (fromCnpj.length >= 8) return fromCnpj.slice(0, 8).padStart(8, "0");
  return fromCnpj.length ? fromCnpj.padStart(8, "0") : null;
}

/**
 * @param {object} payload
 * @returns {string|null}
 */
export function profileUrlFromPayload(payload = {}) {
  const basico = cnpjBasicoFromPayload(payload);
  return basico ? `${PERFIL_BASE_URL}/${basico}` : null;
}

/**
 * Normaliza URL de site (adiciona https:// se faltar esquema).
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeSiteUrl(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t || t === "-" || t.toLowerCase() === "null" || t.toLowerCase() === "n/a") {
    return null;
  }
  if (/^https?:\/\//i.test(t)) return t;
  if (/^www\./i.test(t) || /^[\w.-]+\.[a-z]{2,}/i.test(t)) return `https://${t}`;
  return t;
}

/**
 * Rótulo curto do site (hostname sem www).
 * @param {string|null} url
 * @returns {string|null}
 */
export function siteLabelFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return String(url)
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0] || null;
  }
}

/**
 * @param {object} payload
 * @returns {string|null}
 */
export function siteFromPayload(payload = {}) {
  return normalizeSiteUrl(
    payload.site ?? payload.website ?? payload.url ?? payload.link_site ?? null,
  );
}

/**
 * Local com UF na frente: "AL · Maceio"
 * @param {object} payload
 * @returns {string|null}
 */
export function localFromPayload(payload = {}) {
  const uf = typeof payload.uf === "string" ? payload.uf.trim().toUpperCase() : "";
  const rawCity =
    (typeof payload.cidade === "string" && payload.cidade.trim()) ||
    (typeof payload.municipio === "string" && payload.municipio.trim()) ||
    "";
  const cidade = softTitleCase(rawCity);
  if (uf && cidade) return `${uf} · ${cidade}`;
  if (uf) return uf;
  if (cidade) return cidade;
  return null;
}

/**
 * Markdown pronto: [dominio](url)
 * @param {string|null} url
 */
export function siteMarkdown(url) {
  if (!url) return null;
  const label = siteLabelFromUrl(url) || url;
  return `[${label}](${url})`;
}

/**
 * Markdown pronto: [Perfil Nome](url)
 * @param {string|null} nome
 * @param {string|null} url
 */
export function perfilMarkdown(nome, url) {
  if (!url) return null;
  const label = nome ? `Perfil ${softTitleCase(nome)}` : "Perfil no Busca Fornecedor";
  return `[${label}](${url})`;
}

/**
 * Objeto compacto para o LLM montar a lista no padrão de produto.
 * @param {object[]} results
 * @param {number} [limit]
 */
export function mapResultsForDisplay(results, limit = 20) {
  return (results || []).slice(0, limit).map((r, i) => {
    const p = r.payload && typeof r.payload === "object" ? r.payload : {};
    const descricao =
      typeof p.descricao === "string"
        ? p.descricao.trim()
        : typeof p.descricao_empresa === "string"
          ? p.descricao_empresa.trim()
          : null;
    const cnpjBasico = cnpjBasicoFromPayload(p);
    const nome =
      (typeof p.nome_empresa === "string" && p.nome_empresa.trim()) ||
      (typeof p.razao_social === "string" && p.razao_social.trim()) ||
      null;
    const site = siteFromPayload(p);
    const perfil_url = profileUrlFromPayload(p);
    return {
      posicao: r.posicao ?? i + 1,
      nome_empresa: nome,
      local: localFromPayload(p),
      modelo_negocio:
        typeof p.modelo_negocio === "string" && p.modelo_negocio.trim()
          ? p.modelo_negocio.trim()
          : null,
      descricao: descricao ? descricao.slice(0, 400) : null,
      site,
      site_label: siteLabelFromUrl(site),
      site_md: siteMarkdown(site),
      perfil_url,
      perfil_md: perfilMarkdown(nome, perfil_url),
      cnpj_basico: cnpjBasico,
    };
  });
}

/**
 * Lista markdown no padrão do chat, sem passar pelo LLM.
 * @param {object[]} results
 * @param {{ intro?: string }} [opts]
 */
export function formatResultsMarkdown(results, opts = {}) {
  const items = mapResultsForDisplay(results);
  if (!items.length) {
    return (
      opts.intro ||
      "Nenhum fornecedor encontrado com estes parâmetros. Tente ampliar a região ou ajustar os recortes."
    );
  }
  const lines = [
    opts.intro || `Encontrei ${items.length} fornecedor(es) com os parâmetros ajustados:`,
    "",
  ];
  for (const r of items) {
    const nome = softTitleCase(r.nome_empresa || "Fornecedor");
    lines.push(`${r.posicao}. **${nome}**`);
    if (r.local) lines.push(`   - **Local:** ${r.local}`);
    if (r.modelo_negocio) lines.push(`   - **Modelo de Negócio:** ${r.modelo_negocio}`);
    if (r.descricao) lines.push(`   - **Descrição:** ${r.descricao}`);
    if (r.site_md) lines.push(`   - **Site:** ${r.site_md}`);
    if (r.perfil_md) lines.push(`   - **Perfil:** ${r.perfil_md}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/** Instrução fixa no system prompt do agente. */
export const RESULT_DISPLAY_PROMPT = `Formato OBRIGATÓRIO ao listar fornecedores (não invente campos; omita a linha se o valor for null):

N. **{nome_empresa}**
   - **Local:** {local}
   - **Modelo de Negócio:** {modelo_negocio}
   - **Descrição:** {descricao}
   - **Site:** {site_md}
   - **Perfil:** {perfil_md}

Regras:
- Use site_md e perfil_md EXATAMENTE como vieram na tool (já são links markdown [texto](url)).
- NÃO cole URL crua no lugar do link; NÃO liste CNPJ como campo separado.
- Exemplo de Site: [casaazevedoribeiro.com.br](https://casaazevedoribeiro.com.br)
- Exemplo de Perfil: [Perfil Casa Azevedo Ribeiro](https://buscafornecedor.com.br/perfil/16806116)
- Campos da tool: nome_empresa, local, modelo_negocio, descricao, site_md, perfil_md.`;
