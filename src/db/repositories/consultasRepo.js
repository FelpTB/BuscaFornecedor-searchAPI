/**
 * Persistência de consultas + aparições (cold path).
 * Alinhado ao schema live abcAdvise (busca_fornecedor):
 *   - consultas (já existia)
 *   - aparicoes (cnpj_basico/ordem/dv — NÃO a versão flat antiga do PLANO)
 *   - contador_aparicoes (agg por CNPJ básico de 8 dígitos)
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "../supabaseAdmin.js";
import { getPgPool } from "../pgPool.js";
import { logWarn } from "../../logger.js";

const SCHEMA = "busca_fornecedor";

function digitsOnly(cnpj) {
  return String(cnpj || "").replace(/\D/g, "");
}

/** Quebra CNPJ 14 dígitos no formato do schema live. */
export function splitCnpjParts(cnpj) {
  const d = digitsOnly(cnpj);
  if (d.length === 14) {
    return { basico: d.slice(0, 8), ordem: d.slice(8, 12), dv: d.slice(12, 14) };
  }
  if (d.length === 8) {
    return { basico: d, ordem: null, dv: null };
  }
  return null;
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

    let aparicoesOk = 0;
    for (const row of results) {
      const parts = splitCnpjParts(row.cnpj);
      if (!parts?.basico) continue;

      // Schema live: aparicoes(cnpj_basico, cnpj_ordem, cnpj_dv, nota, revelada)
      // FK para company_profile/estabelecimento pode falhar — contador ainda é atualizado
      try {
        if (parts.ordem && parts.dv) {
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
              Math.round(Number(row.posicao) || 0),
            ],
          );
          aparicoesOk += 1;
        }
      } catch (e) {
        logWarn("aparicoes", "insert skipped (FK/schema)", {
          cnpj_basico: parts.basico,
          message: e.message,
          code: e.code,
        });
      }

      await client.query(
        `INSERT INTO busca_fornecedor.contador_aparicoes (cnpj, n_aparicoes, limite_aparicoes, updated_at)
         VALUES ($1, 1, 999, CURRENT_DATE)
         ON CONFLICT (cnpj) DO UPDATE
         SET n_aparicoes = COALESCE(busca_fornecedor.contador_aparicoes.n_aparicoes, 0) + 1,
             updated_at = CURRENT_DATE`,
        [parts.basico],
      );
    }

    await client.query("COMMIT");
    return {
      ok: true,
      search_id: event.search_id,
      aparicoes: aparicoesOk,
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

  let aparicoesOk = 0;
  for (const r of results) {
    const parts = splitCnpjParts(r.cnpj);
    if (!parts?.basico) continue;

    if (parts.ordem && parts.dv) {
      const { error: apErr } = await sb.schema(SCHEMA).from("aparicoes").insert({
        consulta_id: event.search_id,
        comprador_id: event.user_id,
        cnpj_basico: parts.basico,
        cnpj_ordem: parts.ordem,
        cnpj_dv: parts.dv,
        nota: Math.round(Number(r.posicao) || 0),
        revelada: false,
      });
      if (!apErr) aparicoesOk += 1;
      else if (!/duplicate|23505/i.test(apErr.message || "")) {
        logWarn("aparicoes", "insert skipped", { message: apErr.message, code: apErr.code });
      }
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
    } else {
      await sb.schema(SCHEMA).from("contador_aparicoes").insert({
        cnpj: parts.basico,
        n_aparicoes: 1,
        limite_aparicoes: 999,
        updated_at: new Date().toISOString().slice(0, 10),
      });
    }
  }

  return {
    ok: true,
    search_id: event.search_id,
    aparicoes: aparicoesOk,
    via: "supabase-js",
  };
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
    .select("id, comprador, status, origem, created_at, parametros, resultados")
    .eq("id", searchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
