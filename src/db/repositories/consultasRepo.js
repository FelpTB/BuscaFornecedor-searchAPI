/**
 * Persistência de consultas + aparições (cold path).
 * Alinhado ao schema live abcAdvise (busca_fornecedor):
 *   - consultas.status = 'concluida' (padrão do produto)
 *   - aparicoes (cnpj_basico/ordem/dv)
 *   - contador_aparicoes (agg por CNPJ básico 8 dígitos)
 *   - usuario_comprador.buscas_realizadas (+ n_acessos)
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "../supabaseAdmin.js";
import { getPgPool } from "../pgPool.js";
import { logWarn, logInfo } from "../../logger.js";

const SCHEMA = "busca_fornecedor";
const STATUS_OK = "concluida";
const STATUS_ERR = "erro";

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
      score_final: r.score_final ?? null,
      score_rrf: r.score_rrf ?? null,
    };
  });
}

/** Monta params canônicos para jsonb parametros + colunas densas. */
export function buildConsultaParamFields(params = {}) {
  const queries = params.queries && typeof params.queries === "object" ? params.queries : {};
  const weights = params.weights && typeof params.weights === "object" ? params.weights : {};
  const filter = params.filter && typeof params.filter === "object" ? params.filter : {};

  const bm25Query =
    (typeof params.bm25_query === "string" && params.bm25_query.trim()) ||
    (typeof params.bm25 === "string" && params.bm25.trim()) ||
    (typeof queries.bm25 === "string" && queries.bm25.trim()) ||
    null;

  const queryText =
    (typeof params.query === "string" && params.query.trim()) ||
    (typeof params.query_text === "string" && params.query_text.trim()) ||
    bm25Query ||
    null;

  const parametros = {
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

  const ufArr = toTextArray(filter.uf ?? params.uf);
  const munArr = toTextArray(filter.cidade ?? filter.municipio ?? params.municipio);

  return {
    parametros,
    v_produto: queries.produto ?? null,
    v_servico: queries.servico ?? null,
    v_descricao: queries.descricao ?? null,
    v_publico: queries.publico ?? null,
    v_cliente: queries.cliente ?? null,
    bm_25: bm25Query,
    uf: ufArr,
    municipio: Array.isArray(munArr) ? munArr.slice(0, 80) : munArr,
    modelo_negocio: filter.modelo_negocio ?? params.modelo_negocio ?? null,
    qualidade: params.intent ?? null,
  };
}

/**
 * Enriquece rows sem CNPJ/nome via company_profile (id numérico ou cnpj).
 * @param {import('pg').Pool|null} pool
 * @param {object[]} rows
 */
async function enrichFromCompanyProfile(pool, rows) {
  if (!pool || !rows?.length) return rows;
  const out = [];
  for (const row of rows) {
    if (row.cnpj && row.nome_empresa && row.cidade && row.uf) {
      out.push(row);
      continue;
    }
    const idNum = Number(row.id);
    let profile = null;
    try {
      if (Number.isFinite(idNum) && idNum > 0 && idNum < 2_147_483_647) {
        const r = await pool.query(
          `SELECT cnpj, nome_empresa, municipio, uf
           FROM busca_fornecedor.company_profile WHERE id = $1 LIMIT 1`,
          [idNum],
        );
        profile = r.rows[0] || null;
      }
      if (!profile && row.cnpj_basico) {
        const r = await pool.query(
          `SELECT cnpj, nome_empresa, municipio, uf
           FROM busca_fornecedor.company_profile WHERE cnpj = $1 LIMIT 1`,
          [row.cnpj_basico],
        );
        profile = r.rows[0] || null;
      }
      if (!profile && row.cnpj) {
        const basico = digitsOnly(row.cnpj).slice(0, 8);
        const r = await pool.query(
          `SELECT cnpj, nome_empresa, municipio, uf
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
    // company_profile.cnpj costuma ser basico (8); se full 14, usar
    const full =
      cnpjDigits.length === 14
        ? cnpjDigits
        : row.cnpj && digitsOnly(row.cnpj).length === 14
          ? digitsOnly(row.cnpj)
          : null;

    out.push({
      ...row,
      cnpj: full || row.cnpj,
      cnpj_basico: (full || cnpjDigits || row.cnpj_basico || "").toString().slice(0, 8) || row.cnpj_basico,
      nome_empresa: row.nome_empresa || profile.nome_empresa || null,
      cidade: row.cidade || profile.municipio || null,
      uf: row.uf || profile.uf || null,
    });
  }
  return out;
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

  const pool = getPgPool();
  if (pool) {
    return persistWithPg(pool, event);
  }
  return persistWithSupabaseJs(event);
}

async function persistWithPg(pool, event) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let results = summarizeResultsForStorage(
      event.results?.length ? event.results : event.results_summary || [],
    );
    results = await enrichFromCompanyProfile(pool, results);

    const fields = buildConsultaParamFields(event.params || {});
    const status =
      event.status === STATUS_ERR || event.status === "error"
        ? STATUS_ERR
        : STATUS_OK;

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
      JSON.stringify(results),
      status,
      event.session_id || null,
      event.search_id,
      fields.v_produto,
      fields.v_servico,
      fields.v_descricao,
      fields.v_publico,
      fields.v_cliente,
      fields.bm_25,
      fields.uf,
      fields.municipio,
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
      const parts =
        splitCnpjParts(row.cnpj) ||
        (row.cnpj_basico
          ? {
              basico: digitsOnly(row.cnpj_basico).slice(0, 8),
              ordem: row.cnpj_ordem || null,
              dv: row.cnpj_dv || null,
            }
          : null);

      if (!parts?.basico) {
        logWarn("aparicoes", "resultado sem CNPJ — skip aparicao/contador", {
          search_id: event.search_id,
          point_id: row.id,
          posicao: row.posicao,
        });
        continue;
      }

      const ordem = parts.ordem || "0001";
      const dv = parts.dv || "00";

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
            ordem,
            dv,
            Math.round(Number(row.posicao) || 0),
          ],
        );
        aparicoesOk += 1;
      } catch (e) {
        logWarn("aparicoes", "insert skipped (FK/schema)", {
          cnpj_basico: parts.basico,
          message: e.message,
          code: e.code,
        });
      }

      try {
        await client.query(
          `INSERT INTO busca_fornecedor.contador_aparicoes (cnpj, n_aparicoes, limite_aparicoes, updated_at)
           VALUES ($1, 1, 999, CURRENT_DATE)
           ON CONFLICT (cnpj) DO UPDATE
           SET n_aparicoes = COALESCE(busca_fornecedor.contador_aparicoes.n_aparicoes, 0) + 1,
               updated_at = CURRENT_DATE`,
          [parts.basico],
        );
        contadorOk += 1;
      } catch (e) {
        logWarn("contador_aparicoes", "upsert failed", {
          cnpj: parts.basico,
          message: e.message,
          code: e.code,
        });
      }
    }

    await client.query("COMMIT");
    logInfo("telemetry", "consulta persistida", {
      search_id: event.search_id,
      status,
      resultados: results.length,
      aparicoes: aparicoesOk,
      contador: contadorOk,
    });
    return {
      ok: true,
      search_id: event.search_id,
      status,
      resultados: results.length,
      aparicoes: aparicoesOk,
      contador: contadorOk,
      results,
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

  const fields = buildConsultaParamFields(event.params || {});
  const status =
    event.status === STATUS_ERR || event.status === "error" ? STATUS_ERR : STATUS_OK;

  const row = {
    id: event.search_id,
    comprador: event.user_id,
    parametros: fields.parametros,
    resultados: results,
    status,
    session_id: event.session_id || null,
    execution_id: event.search_id,
    v_produto: fields.v_produto,
    v_servico: fields.v_servico,
    v_descricao: fields.v_descricao,
    v_publico: fields.v_publico,
    v_cliente: fields.v_cliente,
    bm_25: fields.bm_25,
    uf: fields.uf,
    municipio: fields.municipio,
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
    const parts =
      splitCnpjParts(r.cnpj) ||
      (r.cnpj_basico
        ? { basico: digitsOnly(r.cnpj_basico).slice(0, 8), ordem: r.cnpj_ordem, dv: r.cnpj_dv }
        : null);
    if (!parts?.basico) continue;

    const ordem = parts.ordem || "0001";
    const dv = parts.dv || "00";

    const { error: apErr } = await sb.schema(SCHEMA).from("aparicoes").insert({
      consulta_id: event.search_id,
      comprador_id: event.user_id,
      cnpj_basico: parts.basico,
      cnpj_ordem: ordem,
      cnpj_dv: dv,
      nota: Math.round(Number(r.posicao) || 0),
      revelada: false,
    });
    if (!apErr) aparicoesOk += 1;
    else if (!/duplicate|23505/i.test(apErr.message || "")) {
      logWarn("aparicoes", "insert skipped", { message: apErr.message, code: apErr.code });
    }

    const { data: agg } = await sb
      .schema(SCHEMA)
      .from("contador_aparicoes")
      .select("id, n_aparicoes")
      .eq("cnpj", parts.basico)
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
        cnpj: parts.basico,
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
    resultados: results.length,
    aparicoes: aparicoesOk,
    contador: contadorOk,
    results,
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
      "id, comprador, status, origem, created_at, parametros, resultados, v_produto, v_servico, v_descricao, v_publico, v_cliente, bm_25, uf, municipio, modelo_negocio",
    )
    .eq("id", searchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
