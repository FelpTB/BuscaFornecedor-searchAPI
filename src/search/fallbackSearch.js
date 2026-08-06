/**
 * Fallback Vector — amplia busca regional insuficiente (cidade → UF → nacional).
 * Exclui CNPJs já listados. Objetivo: aproximar len(resultados) do final_limit pedido.
 */

/**
 * @param {object[]} results
 * @returns {string[]}
 */
export function extractCnpjs(results = []) {
  const out = [];
  for (const r of results) {
    const cnpj = r?.payload?.cnpj ?? r?.cnpj;
    if (typeof cnpj === "string" && cnpj.trim()) out.push(cnpj.trim());
  }
  return out;
}

/**
 * Remove chaves geográficas; preserva modelo_negocio e demais filtros de negócio.
 * @param {object|null|undefined} filter
 */
export function stripGeoFilter(filter) {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) return {};
  const out = {};
  for (const [k, v] of Object.entries(filter)) {
    if (k === "cidade" || k === "uf" || k === "municipio") continue;
    out[k] = v;
  }
  return out;
}

/**
 * @param {object|null|undefined} baseArgs
 * @param {object|null|undefined} plan
 * @param {object[]} results
 * @returns {string|null}
 */
export function resolveUfFromContext(baseArgs, plan, results = []) {
  const fromFilter = baseArgs?.filter?.uf;
  if (typeof fromFilter === "string" && fromFilter.trim()) {
    return fromFilter.trim().toUpperCase();
  }
  if (Array.isArray(fromFilter)) {
    const first = fromFilter.find((u) => typeof u === "string" && u.trim());
    if (first) return first.trim().toUpperCase();
  }
  const geoUf = plan?.geo?.uf || plan?.query_manager?.uf;
  if (typeof geoUf === "string" && geoUf.trim()) return geoUf.trim().toUpperCase();

  for (const r of results) {
    const uf = r?.payload?.uf;
    if (typeof uf === "string" && uf.trim()) return uf.trim().toUpperCase();
  }
  return null;
}

/**
 * @param {object|null|undefined} filter
 */
export function hasCityFilter(filter) {
  const c = filter?.cidade;
  if (c == null) return false;
  if (Array.isArray(c)) return c.some((x) => typeof x === "string" && x.trim());
  return typeof c === "string" && c.trim() !== "";
}

/**
 * @param {object|null|undefined} filter
 */
export function hasUfFilter(filter) {
  const u = filter?.uf;
  if (u == null) return false;
  if (Array.isArray(u)) return u.some((x) => typeof x === "string" && x.trim());
  return typeof u === "string" && u.trim() !== "";
}

/**
 * Monta estágios de relaxamento a partir do filtro atual.
 * @returns {{ name: string, filter: object }[]}
 */
export function buildFallbackStages(baseArgs, plan, existingResults = []) {
  const filter = baseArgs?.filter && typeof baseArgs.filter === "object" ? baseArgs.filter : {};
  const business = stripGeoFilter(filter);
  const stages = [];
  const uf = resolveUfFromContext(baseArgs, plan, existingResults);

  if (hasCityFilter(filter)) {
    if (uf) {
      stages.push({ name: "uf", filter: { ...business, uf } });
    }
    stages.push({ name: "nacional", filter: { ...business } });
    return stages;
  }

  if (hasUfFilter(filter)) {
    stages.push({ name: "nacional", filter: { ...business } });
    return stages;
  }

  // Já nacional / sem geo — nada a expandir
  return [];
}

/**
 * Une resultados novos sem CNPJ duplicado; renumerando posicao.
 * @param {object[]} existing
 * @param {object[]} incoming
 * @param {number} finalLimit
 * @param {Set<string>} excluded
 */
export function mergeUniqueResults(existing, incoming, finalLimit, excluded) {
  const merged = [...existing];
  let added = 0;
  for (const r of incoming || []) {
    if (merged.length >= finalLimit) break;
    const cnpj = r?.payload?.cnpj ?? r?.cnpj;
    const key = typeof cnpj === "string" ? cnpj.trim() : "";
    if (key && excluded.has(key)) continue;
    if (key) excluded.add(key);
    merged.push(r);
    added += 1;
  }
  return {
    results: merged.slice(0, finalLimit).map((r, i) => ({
      ...r,
      posicao: i + 1,
    })),
    added,
  };
}

/**
 * Executa cascata Fallback Vector reutilizando args da última busca.
 *
 * @param {object} opts
 * @param {object} opts.baseArgs — arguments de search_text da busca original
 * @param {object|null} [opts.plan] — plano QM / geo da sessão
 * @param {object[]} opts.existingResults
 * @param {number} opts.finalLimit
 * @param {(args: object, opts?: object) => Promise<object>} opts.executeSearchByText
 */
export async function runFallbackCascade({
  baseArgs,
  plan = null,
  existingResults = [],
  finalLimit = 10,
  executeSearchByText,
}) {
  if (!baseArgs || typeof baseArgs !== "object") {
    const err = new Error("Sem busca anterior na sessão — execute search_suppliers antes");
    err.status = 400;
    throw err;
  }
  if (typeof executeSearchByText !== "function") {
    const err = new Error("executeSearchByText é obrigatório");
    err.status = 500;
    throw err;
  }

  const limit =
    Number.isInteger(Number(finalLimit)) && Number(finalLimit) >= 1
      ? Number(finalLimit)
      : 10;

  const excluded = new Set(extractCnpjs(existingResults));
  let merged = Array.isArray(existingResults) ? [...existingResults] : [];
  const stageReports = [];
  const stages = buildFallbackStages(baseArgs, plan, merged);

  if (stages.length === 0) {
    return {
      ok: true,
      fallback: true,
      expanded: false,
      reason: "busca_ja_nacional_ou_sem_geo",
      requested_limit: limit,
      result_count_before: merged.length,
      result_count: Math.min(merged.length, limit),
      shortfall: Math.max(0, limit - merged.length),
      stages: [],
      results: merged.slice(0, limit).map((r, i) => ({ ...r, posicao: i + 1 })),
      filled: merged.length >= limit,
    };
  }

  const prevFilterNot =
    baseArgs.filter_not && typeof baseArgs.filter_not === "object"
      ? { ...baseArgs.filter_not }
      : {};

  for (const stage of stages) {
    if (merged.length >= limit) break;
    const need = limit - merged.length;
    const fetchLimit = Math.min(Math.max(need * 2, need), 100);

    const args = {
      ...baseArgs,
      filter: Object.keys(stage.filter).length ? stage.filter : undefined,
      filter_not: {
        ...prevFilterNot,
        cnpj: [...excluded],
      },
      final_limit: fetchLimit,
      // mantém queries/weights/bm25 da busca original
    };
    if (!args.filter) delete args.filter;

    const started = Date.now();
    let search;
    try {
      search = await executeSearchByText(args, {
        debug: args.debug === true,
        rerank: args.rerank === true,
      });
    } catch (e) {
      stageReports.push({
        name: stage.name,
        ok: false,
        error: e.message || String(e),
        status: e.status,
        duration_ms: Date.now() - started,
      });
      continue;
    }

    const incoming = Array.isArray(search?.results) ? search.results : [];
    const { results: next, added } = mergeUniqueResults(merged, incoming, limit, excluded);
    merged = next;

    stageReports.push({
      name: stage.name,
      ok: true,
      fetched: incoming.length,
      added,
      result_count_after: merged.length,
      search_id: search?.search_id ?? null,
      duration_ms: Date.now() - started,
      filter: stage.filter,
    });
  }

  const renumbered = merged.map((r, i) => ({ ...r, posicao: i + 1 }));

  return {
    ok: true,
    fallback: true,
    expanded: stageReports.some((s) => s.ok && s.added > 0),
    requested_limit: limit,
    result_count_before: existingResults.length,
    result_count: renumbered.length,
    shortfall: Math.max(0, limit - renumbered.length),
    stages: stageReports,
    results: renumbered,
    filled: renumbered.length >= limit,
  };
}
