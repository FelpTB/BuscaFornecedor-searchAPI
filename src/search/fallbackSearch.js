/**
 * Fallback Vector — amplia busca regional (cidade → UF → nacional).
 * Exclui CNPJs já listados. Em modo replace (padrão quando a cota já está cheia),
 * prioriza empresas NOVAS do escopo ampliado — não reutiliza o lote regional ruim.
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

  return [];
}

/**
 * @param {{ name: string, filter: object }[]} stages
 * @param {'auto'|'uf'|'nacional'} scope
 */
export function selectStagesByScope(stages, scope = "auto") {
  const s = String(scope || "auto").toLowerCase();
  if (s === "nacional" || s === "national") {
    const nat = stages.filter((x) => x.name === "nacional");
    return nat.length ? nat : stages.slice(-1);
  }
  if (s === "uf" || s === "estadual" || s === "state") {
    const ufOnly = stages.filter((x) => x.name === "uf");
    return ufOnly.length ? ufOnly : stages;
  }
  return stages;
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

function renumber(results, limit) {
  return (results || []).slice(0, limit).map((r, i) => ({ ...r, posicao: i + 1 }));
}

/**
 * Monta args de search_text para um estágio — remove geo anterior de propósito.
 * @param {object} baseArgs
 * @param {object} stageFilter
 * @param {string[]} excludedCnpjs
 * @param {number} fetchLimit
 */
export function buildStageSearchArgs(baseArgs, stageFilter, excludedCnpjs, fetchLimit) {
  const prevFilterNot =
    baseArgs.filter_not && typeof baseArgs.filter_not === "object"
      ? { ...baseArgs.filter_not }
      : {};

  const args = {
    ...baseArgs,
    final_limit: fetchLimit,
    filter_not: {
      ...prevFilterNot,
      cnpj: excludedCnpjs,
    },
  };

  // Sempre sobrescrever filter: estágio vazio = busca sem geo
  if (stageFilter && Object.keys(stageFilter).length > 0) {
    args.filter = stageFilter;
  } else {
    delete args.filter;
  }

  return args;
}

/**
 * Executa cascata Fallback Vector reutilizando args da última busca.
 *
 * @param {object} opts
 * @param {object} opts.baseArgs
 * @param {object|null} [opts.plan]
 * @param {object[]} opts.existingResults
 * @param {number} opts.finalLimit
 * @param {'auto'|'uf'|'nacional'} [opts.scope]
 * @param {'fill'|'replace'|'auto'} [opts.mode]
 *   - fill: completa cota mantendo resultados anteriores
 *   - replace: devolve só empresas NOVAS do escopo ampliado (não repete o lote regional)
 *   - auto: fill se result_count < limit; replace se a cota já estava cheia
 * @param {(args: object, opts?: object) => Promise<object>} opts.executeSearchByText
 */
export async function runFallbackCascade({
  baseArgs,
  plan = null,
  existingResults = [],
  finalLimit = 10,
  scope = "auto",
  mode = "auto",
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

  const existing = Array.isArray(existingResults) ? [...existingResults] : [];
  const resolvedMode =
    mode === "fill" || mode === "replace"
      ? mode
      : existing.length >= limit
        ? "replace"
        : "fill";

  const allStages = buildFallbackStages(baseArgs, plan, existing);
  const stages = selectStagesByScope(allStages, scope);

  if (stages.length === 0) {
    return {
      ok: true,
      fallback: true,
      expanded: false,
      reason: "busca_ja_nacional_ou_sem_geo",
      mode: resolvedMode,
      scope,
      requested_limit: limit,
      result_count_before: existing.length,
      result_count: Math.min(existing.length, limit),
      new_count: 0,
      shortfall: Math.max(0, limit - existing.length),
      stages: [],
      results: renumber(existing, limit),
      filled: existing.length >= limit,
      last_filter: baseArgs.filter ?? null,
    };
  }

  const excluded = new Set(extractCnpjs(existing));
  const newHits = [];
  const stageReports = [];

  // Sempre tenta buscar empresas NOVAS nos estágios amplos —
  // mesmo se o lote regional já encheu o final_limit (caso típico de relevância ruim).
  for (const stage of stages) {
    if (newHits.length >= limit) break;

    const need = limit - newHits.length;
    const fetchLimit = Math.min(Math.max(need * 3, need), 100);
    const args = buildStageSearchArgs(baseArgs, stage.filter, [...excluded], fetchLimit);

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
        filter: stage.filter,
        filter_removed_geo: true,
      });
      continue;
    }

    const incoming = Array.isArray(search?.results) ? search.results : [];
    let added = 0;
    for (const r of incoming) {
      if (newHits.length >= limit) break;
      const cnpj = r?.payload?.cnpj ?? r?.cnpj;
      const key = typeof cnpj === "string" ? cnpj.trim() : "";
      if (key && excluded.has(key)) continue;
      if (key) excluded.add(key);
      newHits.push(r);
      added += 1;
    }

    stageReports.push({
      name: stage.name,
      ok: true,
      fetched: incoming.length,
      added,
      new_count_after: newHits.length,
      search_id: search?.search_id ?? null,
      duration_ms: Date.now() - started,
      filter: Object.keys(stage.filter || {}).length ? stage.filter : null,
      filter_removed_geo: true,
    });
  }

  let finalResults;
  if (resolvedMode === "replace") {
    finalResults = renumber(newHits, limit);
  } else {
    // fill: anteriores + novos até o limite
    const { results } = mergeUniqueResults(
      existing,
      newHits,
      limit,
      new Set(extractCnpjs(existing)),
    );
    finalResults = results;
  }

  const lastOk = [...stageReports].reverse().find((s) => s.ok);
  const lastFilter =
    lastOk && Object.prototype.hasOwnProperty.call(lastOk, "filter")
      ? lastOk.filter
      : null;

  return {
    ok: true,
    fallback: true,
    expanded: stageReports.some((s) => s.ok && s.added > 0),
    mode: resolvedMode,
    scope,
    requested_limit: limit,
    result_count_before: existing.length,
    result_count: finalResults.length,
    new_count: newHits.length,
    shortfall: Math.max(0, limit - finalResults.length),
    stages: stageReports,
    results: finalResults,
    filled: finalResults.length >= limit,
    last_filter: lastFilter,
    hint:
      newHits.length === 0
        ? "Nenhuma empresa nova no escopo ampliado (filtros geo removidos; CNPJs anteriores excluídos)."
        : null,
  };
}
