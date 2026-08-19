/**
 * Persistência de consultas + aparições (cold path).
 * Alinhado ao schema live abcAdvise (busca_fornecedor):
 *   - consultas.status = 'concluida' (padrão do produto)
 *   - parametros/resultados no contrato canônico do front (site/whatsapp)
 *   - aparicoes (cnpj_basico; ordem/dv null se desconhecido — evita FK estabelecimento)
 *   - contador_aparicoes (agg por CNPJ básico 8 dígitos)
 *   - usuario_comprador.buscas_realizadas (+ n_acessos)
 *
 * Contrato canônico (front):
 *   parametros: { descricao, tipo_busca, cidade_origem, raio_km, ufs_selecionadas,
 *                 cnpjs_existentes, modelo_negocio?, raw? }
 *   resultados[]: { item: { razao_social, cnpj_basico, nota (75-100 posicional n8n), telefone, email,
 *                 site, escopo, plano_categoria, fornecedor_id, consulta_id,
 *                 n_listagens, "limite_listagens ", modelo_negocio? } }
 *   qualidade: só avaliação do comprador (Ótimo/Bom/Ruim/Péssimo) — nunca intent
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "../supabaseAdmin.js";
import { getPgPool } from "../pgPool.js";
import { mapSupabaseError } from "../mapSupabaseError.js";
import { logWarn, logInfo } from "../../logger.js";
import { AppError } from "../../errors/AppError.js";

const SCHEMA = "busca_fornecedor";
const STATUS_OK = "concluida";
const STATUS_ERR = "erro";
export const QUALIDADE_VALUES = ["Ótimo", "Bom", "Ruim", "Péssimo"];
const QUALIDADE_AVALIACAO = new Set(QUALIDADE_VALUES);

function digitsOnly(cnpj) {
  return String(cnpj || "").replace(/\D/g, "");
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    const s = typeof v === "string" ? v.trim() : v;
    if (s === "" || s === "—") continue;
    return s;
  }
  return null;
}

/** Quebra CNPJ 14 dígitos no formato do schema live. */
export function splitCnpjParts(cnpj) {
  const d = digitsOnly(cnpj);
  if (d.length === 14) {
    return { basico: d.slice(0, 8), ordem: d.slice(8, 12), dv: d.slice(12, 14), full: d };
  }
  if (d.length === 8) {
    return { basico: d, ordem: null, dv: null, full: d };
  }
  return null;
}

function payloadGet(obj, ...keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (obj[key] != null && String(obj[key]).trim() !== "") return obj[key];
  }
  // case-insensitive fallback
  const lowerMap = Object.create(null);
  for (const [k, v] of Object.entries(obj)) {
    if (typeof k === "string") lowerMap[k.toLowerCase()] = v;
  }
  for (const key of keys) {
    const v = lowerMap[String(key).toLowerCase()];
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

/**
 * Normaliza 1 resultado de busca (com ou sem .payload) para storage.
 * Idempotente: pode receber row já flattenada.
 */
export function summarizeResultsForStorage(results = []) {
  return (Array.isArray(results) ? results : []).map((r, index) => {
    const p = r && typeof r.payload === "object" && r.payload ? r.payload : {};
    const nested = r?.item && typeof r.item === "object" ? r.item : {};

    const cnpj = firstNonEmpty(
      payloadGet(p, "cnpj", "cnpj_completo", "CNPJ"),
      payloadGet(nested, "cnpj", "cnpj_completo"),
      r.cnpj,
      nested.cnpj_basico && nested.cnpj_ordem && nested.cnpj_dv
        ? `${nested.cnpj_basico}${nested.cnpj_ordem}${nested.cnpj_dv}`
        : null,
      p.cnpj_basico && p.cnpj_ordem && p.cnpj_dv
        ? `${p.cnpj_basico}${p.cnpj_ordem}${p.cnpj_dv}`
        : null,
    );

    const cnpj_basico = firstNonEmpty(
      payloadGet(p, "cnpj_basico"),
      payloadGet(nested, "cnpj_basico"),
      r.cnpj_basico,
      cnpj ? digitsOnly(cnpj).slice(0, 8) : null,
    );

    return {
      posicao: r.posicao ?? index + 1,
      id: r.id ?? nested.fornecedor_id ?? null,
      cnpj: cnpj ? digitsOnly(cnpj) : null,
      cnpj_basico: cnpj_basico ? digitsOnly(cnpj_basico).slice(0, 8) : null,
      cnpj_ordem: firstNonEmpty(payloadGet(p, "cnpj_ordem"), nested.cnpj_ordem, r.cnpj_ordem),
      cnpj_dv: firstNonEmpty(payloadGet(p, "cnpj_dv"), nested.cnpj_dv, r.cnpj_dv),
      nome_empresa: firstNonEmpty(
        payloadGet(p, "nome_empresa", "razao_social", "nome"),
        payloadGet(nested, "razao_social", "nome_empresa"),
        r.nome_empresa,
        r.razao_social,
      ),
      cidade: firstNonEmpty(
        payloadGet(p, "cidade", "municipio"),
        payloadGet(nested, "municipio", "cidade"),
        r.cidade,
      ),
      uf: firstNonEmpty(payloadGet(p, "uf"), nested.uf, r.uf),
      modelo_negocio: firstNonEmpty(
        payloadGet(p, "modelo_negocio"),
        nested.modelo_negocio,
        r.modelo_negocio,
      ),
      score_final:
        r.score_final ?? (nested.nota != null ? Number(nested.nota) / 100 : null),
      score_rrf: r.score_rrf ?? null,
      telefone: firstNonEmpty(payloadGet(p, "telefone"), nested.telefone, r.telefone),
      email: firstNonEmpty(payloadGet(p, "email"), nested.email, r.email),
      site: firstNonEmpty(payloadGet(p, "site", "url_site"), nested.site, r.site),
      instagram: firstNonEmpty(payloadGet(p, "instagram"), nested.instagram, r.instagram),
      escopo: firstNonEmpty(payloadGet(p, "escopo"), nested.escopo, r.escopo),
      plano_categoria: firstNonEmpty(
        payloadGet(p, "plano_categoria"),
        nested.plano_categoria,
        r.plano_categoria,
      ),
      n_listagens: nested.n_listagens ?? r.n_listagens ?? null,
      limite_listagens: firstNonEmpty(
        nested["limite_listagens "],
        nested.limite_listagens,
        r.limite_listagens,
      ),
    };
  });
}

/**
 * Nota de exibição / aparição (paridade n8n):
 *   total<=1 → 100
 *   senão → round(100 - 25*index/(total-1)) clamp [75,100]
 *   escopo nacional → sempre 100
 * @param {number} index 0-based
 * @param {number} total
 * @param {{ nacional?: boolean, escopo?: string|null }} [opts]
 */
export function positionToNota(index, total, opts = {}) {
  const escopo = String(opts.escopo || "").toLowerCase();
  const nacional =
    opts.nacional === true ||
    escopo === "nacional" ||
    escopo === "national";
  if (nacional) return 100;
  const n = Number(total);
  const i = Number(index);
  if (!Number.isFinite(n) || n <= 1) return 100;
  if (!Number.isFinite(i) || i < 0) return 100;
  let nota = 100 - (25 * i) / (n - 1);
  nota = Math.round(nota);
  return Math.max(75, Math.min(100, nota));
}

/** @deprecated Preferir positionToNota (contrato n8n/aparições). */
export function scoreToNota(scoreFinal) {
  const s = Number(scoreFinal);
  if (!Number.isFinite(s)) return null;
  if (s >= 0 && s <= 1) return Math.round(s * 100);
  if (s > 1 && s <= 100) return Math.round(s);
  return null;
}

/**
 * Empacota rows flattenadas no formato canônico `{ item: {...} }` do front.
 * @param {object[]} rows
 * @param {string|null} consultaId
 */
export function toCanonicalResultItems(rows = [], consultaId = null) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  return list.map((row, index) => {
    const basico = row.cnpj_basico
      ? digitsOnly(row.cnpj_basico).slice(0, 8)
      : row.cnpj
        ? digitsOnly(row.cnpj).slice(0, 8)
        : null;
    const nota =
      row.nota != null && Number.isFinite(Number(row.nota))
        ? Math.round(Number(row.nota))
        : positionToNota(index, total, { escopo: row.escopo });
    const item = {
      razao_social: row.nome_empresa || row.razao_social || null,
      cnpj_basico: basico,
      nota,
      telefone: row.telefone || null,
      email: row.email || null,
      site: row.site || null,
      instagram: row.instagram || null,
      escopo: row.escopo || null,
      plano_categoria: row.plano_categoria ?? null,
      fornecedor_id:
        row.fornecedor_id != null
          ? String(row.fornecedor_id)
          : row.id != null
            ? String(row.id)
            : null,
      consulta_id: consultaId || null,
      n_listagens: Number.isFinite(Number(row.n_listagens)) ? Number(row.n_listagens) : 0,
      // chave com espaço final — compat com payload histórico site/whatsapp
      "limite_listagens ":
        row.limite_listagens != null ? String(row.limite_listagens) : "10",
      modelo_negocio: row.modelo_negocio || null,
      posicao: row.posicao ?? index + 1,
    };
    return { item };
  });
}

/** Atribui `nota` posicional (n8n) em cada row flattenada. */
export function applyPositionNotas(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  return list.map((row, index) => ({
    ...row,
    nota: positionToNota(index, total, { escopo: row.escopo }),
  }));
}

/** Monta params canônicos (front) + colunas densas; preserva payload do motor em `raw`. */
export function buildConsultaParamFields(params = {}) {
  const alreadyCanonical =
    typeof params.descricao === "string" &&
    params.descricao.trim() &&
    !params.query &&
    !params.queries;

  if (alreadyCanonical && params.raw == null) {
    const ufArr = toTextArray(params.ufs_selecionadas ?? params.uf);
    const munArr = toTextArray(
      params.cidade_origem
        ? [params.cidade_origem]
        : params.municipio,
    );
    return {
      parametros: { ...params },
      v_produto: null,
      v_servico: null,
      v_descricao: params.descricao ?? null,
      v_publico: null,
      v_cliente: null,
      bm_25: params.descricao ?? null,
      uf: ufArr,
      municipio: Array.isArray(munArr) ? munArr.slice(0, 80) : munArr,
      modelo_negocio: params.modelo_negocio ?? null,
      qualidade:
        typeof params.qualidade === "string" && QUALIDADE_AVALIACAO.has(params.qualidade)
          ? params.qualidade
          : null,
    };
  }

  const queries = params.queries && typeof params.queries === "object" ? params.queries : {};
  const weights = params.weights && typeof params.weights === "object" ? params.weights : {};
  const filter = params.filter && typeof params.filter === "object" ? params.filter : {};
  const filterNot =
    params.filter_not && typeof params.filter_not === "object" ? params.filter_not : {};

  const bm25Query =
    (typeof params.bm25_query === "string" && params.bm25_query.trim()) ||
    (typeof params.bm25 === "string" && params.bm25.trim()) ||
    (typeof queries.bm25 === "string" && queries.bm25.trim()) ||
    null;

  const queryText =
    (typeof params.query === "string" && params.query.trim()) ||
    (typeof params.query_text === "string" && params.query_text.trim()) ||
    (typeof params.descricao === "string" && params.descricao.trim()) ||
    bm25Query ||
    (typeof queries.descricao === "string" && queries.descricao.trim()) ||
    null;

  const cidades = toTextArray(filter.cidade ?? filter.municipio ?? params.municipio) || [];
  const ufs = toTextArray(filter.uf ?? params.uf ?? params.ufs_selecionadas) || [];
  const hasCidade = cidades.length > 0;
  const hasUf = ufs.length > 0;
  const tipoBusca = hasCidade ? "city" : hasUf ? "uf" : "nacional";

  const cnpjsExistentes = Array.isArray(filterNot.cnpj)
    ? filterNot.cnpj.map(String).join(",")
    : typeof filterNot.cnpj === "string"
      ? filterNot.cnpj
      : typeof params.cnpjs_existentes === "string"
        ? params.cnpjs_existentes
        : "";

  const raw = {
    query: queryText,
    queries: {
      produto: queries.produto ?? null,
      servico: queries.servico ?? null,
      descricao: queries.descricao ?? null,
      publico: queries.publico ?? null,
      cliente: queries.cliente ?? null,
    },
    weights: {
      produto: weights.produto ?? null,
      servico: weights.servico ?? null,
      descricao: weights.descricao ?? null,
      publico: weights.publico ?? null,
      cliente: weights.cliente ?? null,
      bm25: weights.bm25 ?? null,
    },
    filter,
    filter_not: params.filter_not ?? null,
    intent: params.intent ?? null,
    bm25: Boolean(params.bm25 !== false && bm25Query),
    bm25_query: bm25Query,
    final_limit: params.final_limit ?? null,
    limit_per_vector: params.limit_per_vector ?? null,
    debug: Boolean(params.debug),
    rerank: Boolean(params.rerank),
    fallback: Boolean(params.fallback),
  };

  const parametros = {
    descricao: queryText,
    tipo_busca: params.tipo_busca || tipoBusca,
    cidade_origem:
      (typeof params.cidade_origem === "string" && params.cidade_origem.trim()) ||
      cidades[0] ||
      null,
    raio_km: params.raio_km ?? params.radius_km ?? null,
    ufs_selecionadas: ufs,
    cnpjs_existentes: cnpjsExistentes,
    modelo_negocio: filter.modelo_negocio ?? params.modelo_negocio ?? null,
    raw,
  };

  return {
    parametros,
    v_produto: queries.produto ?? null,
    v_servico: queries.servico ?? null,
    v_descricao: queries.descricao ?? queryText ?? null,
    v_publico: queries.publico ?? null,
    v_cliente: queries.cliente ?? null,
    // site/whatsapp preenchem bm_25 com o texto de busca mesmo sem vetor BM25
    bm_25: bm25Query || queryText || null,
    uf: ufs.length ? ufs : null,
    municipio: cidades.length ? cidades.slice(0, 80) : null,
    modelo_negocio: filter.modelo_negocio ?? params.modelo_negocio ?? null,
    // nunca gravar intent em qualidade (coluna de avaliação do comprador)
    qualidade:
      typeof params.qualidade === "string" && QUALIDADE_AVALIACAO.has(params.qualidade)
        ? params.qualidade
        : null,
  };
}

/**
 * Enriquece rows via company_profile (+ contato/plano quando disponível).
 * @param {import('pg').Pool|null} pool
 * @param {object[]} rows
 */
async function enrichFromCompanyProfile(pool, rows) {
  if (!pool || !rows?.length) return rows;
  const out = [];
  for (const row of rows) {
    const needsProfile =
      !row.cnpj ||
      !row.nome_empresa ||
      !row.cidade ||
      !row.uf ||
      !row.telefone ||
      !row.email ||
      !row.site ||
      row.escopo == null ||
      row.plano_categoria == null ||
      row.n_listagens == null;

    if (!needsProfile) {
      out.push(row);
      continue;
    }

    const idNum = Number(row.id);
    let profile = null;
    try {
      if (Number.isFinite(idNum) && idNum > 0 && idNum < 2_147_483_647) {
        const r = await pool.query(
          `SELECT id, cnpj, nome_empresa, municipio, uf, full_profile
           FROM busca_fornecedor.company_profile WHERE id = $1 LIMIT 1`,
          [idNum],
        );
        profile = r.rows[0] || null;
      }
      if (!profile && row.cnpj_basico) {
        const r = await pool.query(
          `SELECT id, cnpj, nome_empresa, municipio, uf, full_profile
           FROM busca_fornecedor.company_profile WHERE cnpj = $1 LIMIT 1`,
          [digitsOnly(row.cnpj_basico).slice(0, 8)],
        );
        profile = r.rows[0] || null;
      }
      if (!profile && row.cnpj) {
        const basico = digitsOnly(row.cnpj).slice(0, 8);
        const r = await pool.query(
          `SELECT id, cnpj, nome_empresa, municipio, uf, full_profile
           FROM busca_fornecedor.company_profile WHERE cnpj = $1 LIMIT 1`,
          [basico],
        );
        profile = r.rows[0] || null;
      }
    } catch (e) {
      logWarn("enrich company_profile", e.message);
    }

    if (!profile) {
      out.push(row);
      continue;
    }

    const cnpjDigits = digitsOnly(profile.cnpj || row.cnpj || "");
    const full =
      cnpjDigits.length === 14
        ? cnpjDigits
        : row.cnpj && digitsOnly(row.cnpj).length === 14
          ? digitsOnly(row.cnpj)
          : null;

    const fp = profile.full_profile && typeof profile.full_profile === "object"
      ? profile.full_profile
      : {};
    const contato = fp.contato && typeof fp.contato === "object" ? fp.contato : {};
    const classificacao =
      fp.classificacao && typeof fp.classificacao === "object" ? fp.classificacao : {};
    const telefones = Array.isArray(contato.telefones)
      ? contato.telefones.filter(Boolean).join(" ")
      : null;
    const emails = Array.isArray(contato.emails)
      ? contato.emails.filter(Boolean).join(" ")
      : null;
    const cob = String(classificacao.cobertura_geografica || "").toLowerCase();
    const escopoNacional =
      /brasil|nacional|todo o pa[ií]s|nationwide/.test(cob) ? "nacional" : null;

    let plano = null;
    let nListagens = row.n_listagens;
    let limite = row.limite_listagens;
    const basico8 = (full || cnpjDigits || row.cnpj_basico || "").toString().slice(0, 8);
    try {
      if (basico8) {
        const ufRow = await pool.query(
          `SELECT plano_categoria, selo_exibicao
           FROM busca_fornecedor.usuario_fornecedor
           WHERE cnpj_basico = $1
           LIMIT 1`,
          [basico8],
        );
        plano = ufRow.rows[0] || null;
        const cnt = await pool.query(
          `SELECT n_aparicoes, limite_aparicoes
           FROM busca_fornecedor.contador_aparicoes WHERE cnpj = $1 LIMIT 1`,
          [basico8],
        );
        if (cnt.rows[0]) {
          nListagens = Number(cnt.rows[0].n_aparicoes || 0);
          if (limite == null && cnt.rows[0].limite_aparicoes != null) {
            limite = String(cnt.rows[0].limite_aparicoes);
          }
        }
      }
    } catch (e) {
      logWarn("enrich plano/contador", e.message);
    }

    out.push({
      ...row,
      cnpj: full || row.cnpj,
      cnpj_basico: basico8 || row.cnpj_basico,
      nome_empresa: row.nome_empresa || profile.nome_empresa || null,
      cidade: row.cidade || profile.municipio || null,
      uf: row.uf || profile.uf || null,
      telefone: row.telefone || telefones || null,
      email: row.email || emails || null,
      site: row.site || contato.url_site || null,
      instagram: row.instagram || contato.url_instagram || null,
      escopo: row.escopo || escopoNacional,
      plano_categoria: row.plano_categoria ?? plano?.plano_categoria ?? null,
      fornecedor_id: row.fornecedor_id ?? profile.id ?? row.id,
      n_listagens: nListagens ?? 0,
      limite_listagens: limite ?? "10",
    });
  }
  return out;
}

/**
 * Resolve cnpj_ordem/dv reais no estabelecimento; se não achar, null (FK MATCH SIMPLE).
 * @param {import('pg').PoolClient|import('pg').Pool} client
 * @param {string} basico
 * @param {string|null|undefined} ordem
 * @param {string|null|undefined} dv
 */
async function resolveEstabelecimentoParts(client, basico, ordem, dv) {
  const b = digitsOnly(basico).slice(0, 8);
  if (!b) return { basico: null, ordem: null, dv: null };
  if (ordem && dv) return { basico: b, ordem: String(ordem), dv: String(dv) };
  try {
    const r = await client.query(
      `SELECT cnpj_ordem, cnpj_dv
       FROM cnpj_db.estabelecimento
       WHERE cnpj_basico = $1
       ORDER BY CASE WHEN cnpj_ordem = '0001' THEN 0 ELSE 1 END, cnpj_ordem
       LIMIT 1`,
      [b],
    );
    if (r.rows[0]) {
      return {
        basico: b,
        ordem: r.rows[0].cnpj_ordem,
        dv: r.rows[0].cnpj_dv,
      };
    }
  } catch (e) {
    logWarn("estabelecimento lookup", e.message);
  }
  // null/null: site/whatsapp fazem assim; evita FK inválida com "0001"/"00" inventados
  return { basico: b, ordem: null, dv: null };
}

function aparicaoNotaFromRow(row) {
  if (row.nota != null && Number.isFinite(Number(row.nota))) {
    return Math.round(Number(row.nota));
  }
  return 100;
}

/**
 * @param {object} event search.completed
 */
export async function persistSearchCompleted(event) {
  if (!isSupabaseConfigured()) {
    return { skipped: true, reason: "supabase_not_configured" };
  }
  if (!event?.user_id || !event?.search_id) {
    return { skipped: true, reason: "missing_user_or_search_id" };
  }

  /**
   * Preferencia: PostgREST (SUPABASE_URL) — mesmo projeto do auth e da API de notificacao.
   * PG (DATABASE_URL) so se PREFER_PG_PERSIST=1; apos PG, valida read-back no Supabase
   * e faz fallback se DATABASE_URL apontar para outro banco.
   */
  const preferPg =
    (process.env.PREFER_PG_PERSIST || "").trim() === "1" && Boolean(getPgPool());

  let result;
  if (preferPg) {
    result = await persistWithPg(getPgPool(), event);
  } else {
    result = await persistWithSupabaseJs(event);
  }

  if (result?.skipped && result.reason === "already_persisted") {
    const backfill = await backfillAparicoesForExistingConsulta(event);
    const visible = await getConsultaById(event.search_id);
    return {
      ...result,
      ...backfill,
      ok: Boolean(backfill?.ok) || Boolean(visible),
      visible_on_supabase: Boolean(visible),
      results: backfill?.results || result.results,
    };
  }

  if (!result?.ok) return result;

  const visible = await getConsultaById(event.search_id);
  if (visible) {
    return { ...result, visible_on_supabase: true };
  }

  // PG gravou em outro DB (ou insert nao refletiu): forca escrita via Supabase JS
  logWarn("telemetry", "consulta nao visivel no Supabase apos persist — fallback supabase-js", {
    search_id: event.search_id,
    via: result?.via,
    hint: "Alinhe DATABASE_URL ao projeto SUPABASE_URL; na API notificacao use POSTGRES_SCHEMA=busca_fornecedor",
  });
  const fallback = await persistWithSupabaseJs(event);
  const visible2 = await getConsultaById(event.search_id);
  return {
    ...fallback,
    ok: Boolean(fallback?.ok) && Boolean(visible2),
    visible_on_supabase: Boolean(visible2),
    db_mismatch_recovered: Boolean(visible2),
    prior_via: result?.via || null,
    results: fallback?.results || result?.results,
  };
}

async function persistWithPg(pool, event) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let results = summarizeResultsForStorage(
      event.results?.length ? event.results : event.results_summary || [],
    );
    results = await enrichFromCompanyProfile(pool, results);
    results = applyPositionNotas(results);

    const fields = buildConsultaParamFields(event.params || {});
    const status =
      event.status === STATUS_ERR || event.status === "error"
        ? STATUS_ERR
        : STATUS_OK;

    const canonicalResults = toCanonicalResultItems(results, event.search_id);

    // Preenche uf/municipio da consulta a partir dos resultados se filtros vazios
    const ufFromResults = [
      ...new Set(results.map((r) => r.uf).filter((u) => typeof u === "string" && u.trim())),
    ];
    const munFromResults = [
      ...new Set(
        results.map((r) => r.cidade).filter((c) => typeof c === "string" && c.trim()),
      ),
    ];
    const ufCol = fields.uf?.length ? fields.uf : ufFromResults.length ? ufFromResults : null;
    const munCol = fields.municipio?.length
      ? fields.municipio
      : munFromResults.length
        ? munFromResults.slice(0, 80)
        : null;

    const insertConsulta = `
      INSERT INTO busca_fornecedor.consultas (
        id, comprador, parametros, resultados, status,
        session_id, execution_id,
        v_produto, v_servico, v_descricao, v_publico, v_cliente, bm_25,
        uf, municipio, modelo_negocio, fallback, origem, qualidade, created_at
      ) VALUES (
        $1,$2,$3::jsonb,$4::jsonb,$5,
        $6,$7,
        $8,$9,$10,$11,$12,$13,
        $14,$15,$16,$17,$18,$19, now()
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;

    const res = await client.query(insertConsulta, [
      event.search_id,
      event.user_id,
      JSON.stringify(fields.parametros),
      JSON.stringify(canonicalResults),
      status,
      event.session_id || null,
      event.search_id,
      fields.v_produto,
      fields.v_servico,
      fields.v_descricao,
      fields.v_publico,
      fields.v_cliente,
      fields.bm_25,
      ufCol,
      munCol,
      fields.modelo_negocio,
      Boolean(event.params?.fallback),
      mapOrigem(event.source),
      fields.qualidade,
    ]);

    if (res.rowCount === 0) {
      await client.query("ROLLBACK");
      return { skipped: true, reason: "already_persisted", search_id: event.search_id };
    }

    await client.query(
      `UPDATE busca_fornecedor.usuario_comprador
       SET buscas_realizadas = COALESCE(buscas_realizadas, 0) + 1,
           n_acessos = COALESCE(n_acessos, 0) + 1
       WHERE id = $1`,
      [event.user_id],
    );

    let aparicoesOk = 0;
    let contadorOk = 0;

    for (const row of results) {
      const basico =
        (row.cnpj_basico && digitsOnly(row.cnpj_basico).slice(0, 8)) ||
        (row.cnpj && digitsOnly(row.cnpj).slice(0, 8)) ||
        null;

      if (!basico) {
        logWarn("aparicoes", "resultado sem CNPJ — skip aparicao/contador", {
          search_id: event.search_id,
          point_id: row.id,
          posicao: row.posicao,
        });
        continue;
      }

      const parts = await resolveEstabelecimentoParts(
        client,
        basico,
        row.cnpj_ordem,
        row.cnpj_dv,
      );

      try {
        await client.query(
          `INSERT INTO busca_fornecedor.aparicoes (
            consulta_id, comprador_id, cnpj_basico, cnpj_ordem, cnpj_dv, nota, revelada
          ) VALUES ($1,$2,$3,$4,$5,$6,false)
          ON CONFLICT (consulta_id, cnpj_basico, cnpj_ordem, cnpj_dv) DO NOTHING`,
          [
            event.search_id,
            event.user_id,
            parts.basico,
            parts.ordem,
            parts.dv,
            aparicaoNotaFromRow(row),
          ],
        );
        aparicoesOk += 1;
      } catch (e) {
        // Fallback: tenta só com basico (ordem/dv null) — padrão site
        try {
          await client.query(
            `INSERT INTO busca_fornecedor.aparicoes (
              consulta_id, comprador_id, cnpj_basico, cnpj_ordem, cnpj_dv, nota, revelada
            ) VALUES ($1,$2,$3,NULL,NULL,$4,false)`,
            [event.search_id, event.user_id, basico, aparicaoNotaFromRow(row)],
          );
          aparicoesOk += 1;
        } catch (e2) {
          logWarn("aparicoes", "insert skipped (FK/schema)", {
            cnpj_basico: basico,
            message: e2.message || e.message,
            code: e2.code || e.code,
          });
        }
      }

      try {
        await client.query(
          `INSERT INTO busca_fornecedor.contador_aparicoes (cnpj, n_aparicoes, limite_aparicoes, updated_at)
           VALUES ($1, 1, 999, CURRENT_DATE)
           ON CONFLICT (cnpj) DO UPDATE
           SET n_aparicoes = COALESCE(busca_fornecedor.contador_aparicoes.n_aparicoes, 0) + 1,
               updated_at = CURRENT_DATE`,
          [basico],
        );
        contadorOk += 1;
      } catch (e) {
        logWarn("contador_aparicoes", "upsert failed", {
          cnpj: basico,
          message: e.message,
          code: e.code,
        });
      }
    }

    await client.query("COMMIT");
    logInfo("telemetry", "consulta persistida", {
      search_id: event.search_id,
      status,
      resultados: canonicalResults.length,
      aparicoes: aparicoesOk,
      contador: contadorOk,
    });
    return {
      ok: true,
      search_id: event.search_id,
      status,
      resultados: canonicalResults.length,
      aparicoes: aparicoesOk,
      contador: contadorOk,
      results: canonicalResults,
      via: "pg",
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

async function persistWithSupabaseJs(event) {
  const sb = getSupabaseAdmin();
  const pool = getPgPool();
  let results = summarizeResultsForStorage(
    event.results?.length ? event.results : event.results_summary || [],
  );
  if (pool) results = await enrichFromCompanyProfile(pool, results);
  results = applyPositionNotas(results);

  const fields = buildConsultaParamFields(event.params || {});
  const status =
    event.status === STATUS_ERR || event.status === "error" ? STATUS_ERR : STATUS_OK;

  const canonicalResults = toCanonicalResultItems(results, event.search_id);

  const ufFromResults = [
    ...new Set(results.map((r) => r.uf).filter((u) => typeof u === "string" && u.trim())),
  ];
  const munFromResults = [
    ...new Set(
      results.map((r) => r.cidade).filter((c) => typeof c === "string" && c.trim()),
    ),
  ];

  const row = {
    id: event.search_id,
    comprador: event.user_id,
    parametros: fields.parametros,
    resultados: canonicalResults,
    status,
    session_id: event.session_id || null,
    execution_id: event.search_id,
    v_produto: fields.v_produto,
    v_servico: fields.v_servico,
    v_descricao: fields.v_descricao,
    v_publico: fields.v_publico,
    v_cliente: fields.v_cliente,
    bm_25: fields.bm_25,
    uf: fields.uf?.length ? fields.uf : ufFromResults.length ? ufFromResults : null,
    municipio: fields.municipio?.length
      ? fields.municipio
      : munFromResults.length
        ? munFromResults.slice(0, 80)
        : null,
    modelo_negocio: fields.modelo_negocio,
    fallback: Boolean(event.params?.fallback),
    origem: mapOrigem(event.source),
    qualidade: fields.qualidade,
  };

  const { error } = await sb.schema(SCHEMA).from("consultas").insert(row);
  if (error) {
    if (error.code === "23505") {
      return { skipped: true, reason: "already_persisted", search_id: event.search_id };
    }
    throw new Error(`consultas insert: ${error.message}`);
  }

  const { data: comprador } = await sb
    .schema(SCHEMA)
    .from("usuario_comprador")
    .select("buscas_realizadas, n_acessos")
    .eq("id", event.user_id)
    .maybeSingle();

  if (comprador) {
    await sb
      .schema(SCHEMA)
      .from("usuario_comprador")
      .update({
        buscas_realizadas: Number(comprador.buscas_realizadas || 0) + 1,
        n_acessos: Number(comprador.n_acessos || 0) + 1,
      })
      .eq("id", event.user_id);
  }

  let aparicoesOk = 0;
  let contadorOk = 0;
  for (const r of results) {
    const basico =
      (r.cnpj_basico && digitsOnly(r.cnpj_basico).slice(0, 8)) ||
      (r.cnpj && digitsOnly(r.cnpj).slice(0, 8)) ||
      null;
    if (!basico) continue;

    let ordem = r.cnpj_ordem || null;
    let dv = r.cnpj_dv || null;
    if (pool && (!ordem || !dv)) {
      const parts = await resolveEstabelecimentoParts(pool, basico, ordem, dv);
      ordem = parts.ordem;
      dv = parts.dv;
    }

    const { error: apErr } = await sb.schema(SCHEMA).from("aparicoes").insert({
      consulta_id: event.search_id,
      comprador_id: event.user_id,
      cnpj_basico: basico,
      cnpj_ordem: ordem,
      cnpj_dv: dv,
      nota: aparicaoNotaFromRow(r),
      revelada: false,
    });
    if (!apErr) aparicoesOk += 1;
    else if (!/duplicate|23505/i.test(apErr.message || "")) {
      // retry com null/null (compat site)
      const { error: apErr2 } = await sb.schema(SCHEMA).from("aparicoes").insert({
        consulta_id: event.search_id,
        comprador_id: event.user_id,
        cnpj_basico: basico,
        cnpj_ordem: null,
        cnpj_dv: null,
        nota: aparicaoNotaFromRow(r),
        revelada: false,
      });
      if (!apErr2) aparicoesOk += 1;
      else if (!/duplicate|23505/i.test(apErr2.message || "")) {
        logWarn("aparicoes", "insert skipped", {
          message: apErr2.message,
          code: apErr2.code,
        });
      }
    }

    const { data: agg } = await sb
      .schema(SCHEMA)
      .from("contador_aparicoes")
      .select("id, n_aparicoes")
      .eq("cnpj", basico)
      .maybeSingle();

    if (agg) {
      await sb
        .schema(SCHEMA)
        .from("contador_aparicoes")
        .update({
          n_aparicoes: Number(agg.n_aparicoes || 0) + 1,
          updated_at: new Date().toISOString().slice(0, 10),
        })
        .eq("id", agg.id);
      contadorOk += 1;
    } else {
      const { error: cErr } = await sb.schema(SCHEMA).from("contador_aparicoes").insert({
        cnpj: basico,
        n_aparicoes: 1,
        limite_aparicoes: 999,
        updated_at: new Date().toISOString().slice(0, 10),
      });
      if (!cErr) contadorOk += 1;
    }
  }

  return {
    ok: true,
    search_id: event.search_id,
    status,
    resultados: canonicalResults.length,
    aparicoes: aparicoesOk,
    contador: contadorOk,
    results: canonicalResults,
    via: "supabase-js",
  };
}

function mapOrigem(source) {
  const s = String(source || "api").toLowerCase();
  if (s === "xray" || s === "x-ray") return "xray";
  if (s === "mcp") return "mcp";
  if (s === "whatsapp") return "whatsapp";
  if (s === "site") return "site";
  if (s === "rest" || s === "api") return "api";
  return s.slice(0, 32) || "api";
}

function toTextArray(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

/** Lê agg live: contador_aparicoes (cnpj = 8 dígitos básicos). */
export async function getAparicoesAgg(cnpj) {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabaseAdmin();
  const dig = digitsOnly(cnpj);
  const basico = dig.length >= 8 ? dig.slice(0, 8) : dig;
  const { data, error } = await sb
    .schema(SCHEMA)
    .from("contador_aparicoes")
    .select("cnpj, n_aparicoes, limite_aparicoes, updated_at")
    .eq("cnpj", basico)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { cnpj: basico, total: 0 };
  return {
    cnpj: data.cnpj,
    total: Number(data.n_aparicoes || 0),
    limite: Number(data.limite_aparicoes || 0),
    updated_at: data.updated_at,
  };
}

export async function getConsultaById(searchId) {
  if (!isSupabaseConfigured() || !searchId) return null;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .schema(SCHEMA)
    .from("consultas")
    .select(
      "id, comprador, status, origem, created_at, parametros, resultados, v_produto, v_servico, v_descricao, v_publico, v_cliente, bm_25, uf, municipio, modelo_negocio, qualidade",
    )
    .eq("id", searchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Se a consulta já existe (23505) mas aparições faltam (crash parcial / fallback reusado),
 * tenta inserir aparições ausentes sem recontar buscas_realizadas.
 * @param {object} event
 */
async function backfillAparicoesForExistingConsulta(event) {
  if (!isSupabaseConfigured() || !event?.search_id || !event?.user_id) {
    return { backfilled: false, reason: "missing_context" };
  }

  const sb = getSupabaseAdmin();
  const { count, error: countErr } = await sb
    .schema(SCHEMA)
    .from("aparicoes")
    .select("id", { count: "exact", head: true })
    .eq("consulta_id", event.search_id);

  if (countErr) {
    logWarn("telemetry", "falha ao contar aparicoes para backfill", {
      search_id: event.search_id,
      message: countErr.message,
    });
    return { backfilled: false, reason: "count_failed" };
  }

  let results = summarizeResultsForStorage(
    event.results?.length ? event.results : event.results_summary || [],
  );
  const pool = getPgPool();
  if (pool) results = await enrichFromCompanyProfile(pool, results);
  results = applyPositionNotas(results);
  const withCnpj = results.filter((r) => {
    const basico =
      (r.cnpj_basico && digitsOnly(r.cnpj_basico).slice(0, 8)) ||
      (r.cnpj && digitsOnly(r.cnpj).slice(0, 8)) ||
      null;
    return Boolean(basico);
  });

  if ((count || 0) >= withCnpj.length && withCnpj.length > 0) {
    return {
      backfilled: false,
      reason: "already_persisted",
      aparicoes_existing: count,
      ok: true,
      results: toCanonicalResultItems(results, event.search_id),
    };
  }

  let aparicoesOk = 0;
  for (const r of results) {
    const basico =
      (r.cnpj_basico && digitsOnly(r.cnpj_basico).slice(0, 8)) ||
      (r.cnpj && digitsOnly(r.cnpj).slice(0, 8)) ||
      null;
    if (!basico) continue;

    let ordem = r.cnpj_ordem || null;
    let dv = r.cnpj_dv || null;
    if (pool && (!ordem || !dv)) {
      const parts = await resolveEstabelecimentoParts(pool, basico, ordem, dv);
      ordem = parts.ordem;
      dv = parts.dv;
    }

    const { error: apErr } = await sb.schema(SCHEMA).from("aparicoes").insert({
      consulta_id: event.search_id,
      comprador_id: event.user_id,
      cnpj_basico: basico,
      cnpj_ordem: ordem,
      cnpj_dv: dv,
      nota: aparicaoNotaFromRow(r),
      revelada: false,
    });
    if (!apErr) {
      aparicoesOk += 1;
      continue;
    }
    if (/duplicate|23505/i.test(apErr.message || "")) continue;

    const { error: apErr2 } = await sb.schema(SCHEMA).from("aparicoes").insert({
      consulta_id: event.search_id,
      comprador_id: event.user_id,
      cnpj_basico: basico,
      cnpj_ordem: null,
      cnpj_dv: null,
      nota: aparicaoNotaFromRow(r),
      revelada: false,
    });
    if (!apErr2) aparicoesOk += 1;
    else if (!/duplicate|23505/i.test(apErr2.message || "")) {
      logWarn("aparicoes", "backfill insert skipped", {
        message: apErr2.message,
        code: apErr2.code,
        search_id: event.search_id,
      });
    }
  }

  // Atualiza resultados da consulta se veio fallback / expansão
  if (event.params?.fallback && results.length) {
    const canonicalResults = toCanonicalResultItems(results, event.search_id);
    await sb
      .schema(SCHEMA)
      .from("consultas")
      .update({
        resultados: canonicalResults,
        fallback: true,
      })
      .eq("id", event.search_id);
  }

  logInfo("telemetry", "backfill aparicoes apos already_persisted", {
    search_id: event.search_id,
    existing: count || 0,
    inserted: aparicoesOk,
    expected: withCnpj.length,
  });

  return {
    backfilled: aparicoesOk > 0,
    reason: "already_persisted",
    aparicoes_existing: count || 0,
    aparicoes: aparicoesOk,
    ok: true,
    results: toCanonicalResultItems(results, event.search_id),
    via: "supabase-js-backfill",
  };
}

/**
 * Avaliação do comprador na consulta (Ótimo/Bom/Ruim/Péssimo).
 * @param {string} searchId
 * @param {string} userId
 * @param {string} qualidade
 */
export async function updateConsultaQualidade(searchId, userId, qualidade) {
  const id = typeof searchId === "string" ? searchId.trim() : "";
  const uid = typeof userId === "string" ? userId.trim() : "";
  const value = typeof qualidade === "string" ? qualidade.trim() : "";
  if (!id) throw AppError.badRequest("searchId obrigatório");
  if (!uid) throw AppError.unauthorized();
  if (!QUALIDADE_AVALIACAO.has(value)) {
    throw AppError.badRequest(`qualidade deve ser uma de: ${QUALIDADE_VALUES.join(", ")}`);
  }

  const pool = getPgPool();
  if (pool) {
    const { rows } = await pool.query(
      `UPDATE busca_fornecedor.consultas
       SET qualidade = $1
       WHERE id = $2 AND comprador = $3
       RETURNING id, qualidade`,
      [value, id, uid],
    );
    if (!rows.length) return null;
    return { id: rows[0].id, qualidade: rows[0].qualidade };
  }

  if (!isSupabaseConfigured()) {
    throw AppError.serviceUnavailable("Persistência não configurada");
  }
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .schema(SCHEMA)
    .from("consultas")
    .update({ qualidade: value })
    .eq("id", id)
    .eq("comprador", uid)
    .select("id, qualidade")
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "avaliar consulta");
  return data;
}
