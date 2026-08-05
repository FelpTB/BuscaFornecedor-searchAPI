/**
 * Persistência de consultas + aparições (cold path).
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "../supabaseAdmin.js";
import { getPgPool } from "../pgPool.js";

const SCHEMA = "busca_fornecedor";

function digitsOnly(cnpj) {
  return String(cnpj || "").replace(/\D/g, "");
}

/** Allowlist de resultado para jsonb. */
export function summarizeResultsForStorage(results = []) {
  return (Array.isArray(results) ? results : []).map((r) => {
    const p = r.payload || {};
    return {
      posicao: r.posicao,
      id: r.id,
      cnpj: p.cnpj || null,
      nome_empresa: p.nome_empresa || null,
      cidade: p.cidade || null,
      uf: p.uf || null,
      modelo_negocio: p.modelo_negocio || null,
      score_final: r.score_final ?? null,
      score_rrf: r.score_rrf ?? null,
    };
  });
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

    const params = event.params || {};
    const results = summarizeResultsForStorage(event.results_summary || event.results);
    const queries = params.queries || {};

    const insertConsulta = `
      INSERT INTO busca_fornecedor.consultas (
        id, comprador, parametros, resultados, status,
        session_id, execution_id,
        v_produto, v_servico, v_descricao, v_publico, bm_25,
        uf, municipio, modelo_negocio, fallback, origem, qualidade, created_at
      ) VALUES (
        $1,$2,$3::jsonb,$4::jsonb,$5,
        $6,$7,
        $8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,$18, now()
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;

    const ufArr = toTextArray(params.filter?.uf ?? params.uf);
    const munArr = toTextArray(params.filter?.cidade ?? params.municipio);

    const res = await client.query(insertConsulta, [
      event.search_id,
      event.user_id,
      JSON.stringify(params),
      JSON.stringify(results),
      event.status || "completed",
      event.session_id || null,
      event.search_id,
      queries.produto || null,
      queries.servico || null,
      queries.descricao || null,
      queries.publico || null,
      params.bm25_query || null,
      ufArr,
      Array.isArray(munArr) ? munArr.slice(0, 80) : munArr,
      params.filter?.modelo_negocio || null,
      Boolean(params.fallback),
      event.source || "api",
      params.intent || null,
    ]);

    if (res.rowCount === 0) {
      await client.query("ROLLBACK");
      return { skipped: true, reason: "already_persisted", search_id: event.search_id };
    }

    await client.query(
      `UPDATE busca_fornecedor.usuario_comprador
       SET buscas_realizadas = COALESCE(buscas_realizadas, 0) + 1
       WHERE id = $1`,
      [event.user_id],
    );

    for (const row of results) {
      const cnpj = digitsOnly(row.cnpj);
      if (!cnpj) continue;
      await client.query(
        `INSERT INTO busca_fornecedor.aparicoes (
          consulta_id, comprador_id, cnpj, nome_empresa, posicao, score_final, cidade, uf, origem
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          event.search_id,
          event.user_id,
          cnpj,
          row.nome_empresa,
          row.posicao,
          row.score_final,
          row.cidade,
          row.uf,
          event.source || "api",
        ],
      );
      await client.query(
        `INSERT INTO busca_fornecedor.aparicoes_cnpj_agg (cnpj, total, last_seen_at)
         VALUES ($1, 1, now())
         ON CONFLICT (cnpj) DO UPDATE
         SET total = busca_fornecedor.aparicoes_cnpj_agg.total + 1,
             last_seen_at = now()`,
        [cnpj],
      );
    }

    await client.query("COMMIT");
    return {
      ok: true,
      search_id: event.search_id,
      aparicoes: results.filter((r) => digitsOnly(r.cnpj)).length,
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
  const params = event.params || {};
  const results = summarizeResultsForStorage(event.results_summary || event.results);
  const queries = params.queries || {};

  const row = {
    id: event.search_id,
    comprador: event.user_id,
    parametros: params,
    resultados: results,
    status: event.status || "completed",
    session_id: event.session_id || null,
    execution_id: event.search_id,
    v_produto: queries.produto || null,
    v_servico: queries.servico || null,
    v_descricao: queries.descricao || null,
    v_publico: queries.publico || null,
    bm_25: params.bm25_query || null,
    uf: toTextArray(params.filter?.uf ?? params.uf),
    municipio: (() => {
      const a = toTextArray(params.filter?.cidade ?? params.municipio);
      return Array.isArray(a) ? a.slice(0, 80) : a;
    })(),
    modelo_negocio: params.filter?.modelo_negocio || null,
    fallback: Boolean(params.fallback),
    origem: event.source || "api",
    qualidade: params.intent || null,
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
    .select("buscas_realizadas")
    .eq("id", event.user_id)
    .maybeSingle();

  if (comprador) {
    await sb
      .schema(SCHEMA)
      .from("usuario_comprador")
      .update({
        buscas_realizadas: Number(comprador.buscas_realizadas || 0) + 1,
      })
      .eq("id", event.user_id);
  }

  const aparicoes = [];
  for (const r of results) {
    const cnpj = digitsOnly(r.cnpj);
    if (!cnpj) continue;
    aparicoes.push({
      consulta_id: event.search_id,
      comprador_id: event.user_id,
      cnpj,
      nome_empresa: r.nome_empresa,
      posicao: r.posicao,
      score_final: r.score_final,
      cidade: r.cidade,
      uf: r.uf,
      origem: event.source || "api",
    });
  }

  if (aparicoes.length) {
    const { error: apErr } = await sb.schema(SCHEMA).from("aparicoes").insert(aparicoes);
    if (apErr && !String(apErr.message).includes("does not exist")) {
      throw new Error(`aparicoes insert: ${apErr.message}`);
    }
    for (const a of aparicoes) {
      const { data: agg } = await sb
        .schema(SCHEMA)
        .from("aparicoes_cnpj_agg")
        .select("total")
        .eq("cnpj", a.cnpj)
        .maybeSingle();
      if (agg) {
        await sb
          .schema(SCHEMA)
          .from("aparicoes_cnpj_agg")
          .update({ total: Number(agg.total) + 1, last_seen_at: new Date().toISOString() })
          .eq("cnpj", a.cnpj);
      } else {
        await sb.schema(SCHEMA).from("aparicoes_cnpj_agg").insert({
          cnpj: a.cnpj,
          total: 1,
          last_seen_at: new Date().toISOString(),
        });
      }
    }
  }

  return {
    ok: true,
    search_id: event.search_id,
    aparicoes: aparicoes.length,
    via: "supabase-js",
  };
}

function toTextArray(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

export async function getAparicoesAgg(cnpj) {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabaseAdmin();
  const dig = digitsOnly(cnpj);
  const { data, error } = await sb
    .schema(SCHEMA)
    .from("aparicoes_cnpj_agg")
    .select("cnpj, total, last_seen_at")
    .eq("cnpj", dig)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getConsultaById(searchId) {
  if (!isSupabaseConfigured() || !searchId) return null;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .schema(SCHEMA)
    .from("consultas")
    .select("id, comprador, status, origem, created_at, parametros, resultados")
    .eq("id", searchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
