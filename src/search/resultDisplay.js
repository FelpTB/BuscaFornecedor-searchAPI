/**
 * Padronização de exibição de resultados de fornecedor (chat + X-Ray).
 *
 * Campos ao usuário:
 * - Nome da empresa
 * - Local: UF · Cidade
 * - Modelo de Negócio
 * - Descrição
 * - Site (se houver)
 * - Perfil BuscaFornecedor: https://buscafornecedor.com.br/perfil/{cnpj_basico}
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
 * CNPJ básico (8 dígitos) para URL de perfil.
 * Aceita cnpj_basico, cnpj completo (14) ou formatado.
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
 * @param {object} payload
 * @returns {string|null}
 */
export function siteFromPayload(payload = {}) {
  return normalizeSiteUrl(
    payload.site ?? payload.website ?? payload.url ?? payload.link_site ?? null,
  );
}

/**
 * Local com UF na frente: "RS · Novo Hamburgo"
 * @param {object} payload
 * @returns {string|null}
 */
export function localFromPayload(payload = {}) {
  const uf = typeof payload.uf === "string" ? payload.uf.trim().toUpperCase() : "";
  const cidade =
    (typeof payload.cidade === "string" && payload.cidade.trim()) ||
    (typeof payload.municipio === "string" && payload.municipio.trim()) ||
    "";
  if (uf && cidade) return `${uf} · ${cidade}`;
  if (uf) return uf;
  if (cidade) return cidade;
  return null;
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
    return {
      posicao: r.posicao ?? i + 1,
      nome_empresa:
        (typeof p.nome_empresa === "string" && p.nome_empresa.trim()) ||
        (typeof p.razao_social === "string" && p.razao_social.trim()) ||
        null,
      local: localFromPayload(p),
      modelo_negocio:
        typeof p.modelo_negocio === "string" && p.modelo_negocio.trim()
          ? p.modelo_negocio.trim()
          : null,
      descricao: descricao ? descricao.slice(0, 400) : null,
      site: siteFromPayload(p),
      perfil_url: profileUrlFromPayload(p),
      // interno — não exibir CNPJ solto na conversa; só para montar perfil
      cnpj_basico: cnpjBasico,
    };
  });
}

/** Instrução fixa no system prompt do agente. */
export const RESULT_DISPLAY_PROMPT = `Formato OBRIGATÓRIO ao listar fornecedores (não invente campos; omita linha se valor null):
N. **{nome_empresa}**
   - **Local:** {local}   ← já vem como "UF · Cidade" (UF na frente)
   - **Modelo de Negócio:** {modelo_negocio}
   - **Descrição:** {descricao}
   - **Site:** {site}     ← só se site não for null
   - **Perfil:** {perfil_url}

Não liste CNPJ como campo separado (o Perfil já usa o CNPJ básico).
Não use negrito em todos os rótulos além do padrão acima.
Use exatamente os campos do array "top" retornado pela tool (nome_empresa, local, modelo_negocio, descricao, site, perfil_url).`;
