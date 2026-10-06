#!/usr/bin/env node
/**
 * Bateria de avaliação dos weight_preset (escopo | publico_alvo | equilibrado).
 *
 * 1. search   — roda cada variação de query contra uma grade de pesos (search_focus=mista).
 * 2. judge    — LLM-juiz dá nota 0-3 de escopo e de público para cada empresa retornada.
 * 3. score    — nDCG@10 por preset (ganho específico), suavização na grade e bootstrap por família.
 * 4. validate — compara presets atuais x recomendados com o search_focus de cada família.
 *
 * Uso: node scripts/eval/weight-presets.mjs [--phase=all|search,judge,score,validate] [--dataset=arquivo.json]
 * Env: EVAL_CONCURRENCY (6), EVAL_JUDGE_MODEL (gpt-4.1-mini). Cache em eval-output/weight-presets/.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { Embeddings } from "openai/resources/embeddings";

process.env.SKIP_ENV_VALIDATION ??= "1";

// A grade repete as mesmas queries em todas as configs: memoiza embeddings no processo.
const embedCache = new Map();
const originalEmbedCreate = Embeddings.prototype.create;
Embeddings.prototype.create = function cachedCreate(body, options) {
  const key = JSON.stringify([body.model, body.input, body.dimensions ?? null]);
  if (!embedCache.has(key)) {
    const p = Promise.resolve(originalEmbedCreate.call(this, body, options));
    p.catch(() => embedCache.delete(key));
    embedCache.set(key, p);
  }
  return embedCache.get(key);
};

const rawLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === "string" && args[0].includes("[POST /search/text]")) return;
  rawLog(...args);
};

const { executeSearchByText } = await import("../../src/searchService.js");
const { WEIGHT_PRESETS } = await import("../../src/search/weightPresets.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const cli = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);
const DATASET_PATH = path.resolve(HERE, cli.dataset || "queries-construcao-civil.json");
const OUT_DIR = path.join(ROOT, "eval-output", "weight-presets");
const PHASES = !cli.phase || cli.phase === "all" ? ["search", "judge", "score", "validate"] : cli.phase.split(",");
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY || 6);
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || "gpt-4.1-mini";
const TOP_K = 10;
const JUDGE_BATCH = 15;
const BOOTSTRAP_ROUNDS = 1000;
const RATIOS = [0.25, 0.5, 0.75, 1];
const PRESET_NAMES = ["escopo", "publico_alvo", "equilibrado"];
const SCOPE_LOSS_TOLERANCE = 0.04;

/** Ganho por resultado: e = nota de escopo, p = nota de público (0-3). */
const GAINS = {
  escopo: ({ e }) => e,
  publico_alvo: ({ e, p }) => (p * Math.min(e, 2)) / 2,
  equilibrado: ({ e, p }) => (e > 0 ? (e + p) / 2 : 0),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const file = (name) => path.join(OUT_DIR, name);
const loadJson = (name, fallback) => (fs.existsSync(file(name)) ? JSON.parse(fs.readFileSync(file(name), "utf8")) : fallback);
const saveJson = (name, data) => fs.writeFileSync(file(name), JSON.stringify(data, null, 1));

const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, "utf8"));
const families = dataset.families;
const queries = families.flatMap((fam) => fam.variations.map((text, i) => ({ qid: `${fam.id}#${i + 1}`, fam, text })));

const searches = loadJson("searches.json", {});
const companies = loadJson("companies.json", {});
const judgments = loadJson("judgments.json", {});

// ---------------------------------------------------------------- grade de pesos

function weightsFromMille(S, D, A, r) {
  const pub = A > 0 ? Math.round(A * r) : 0;
  return {
    produto: S / 2000,
    servico: S / 2000,
    descricao: D / 1000,
    publico: pub / 1000,
    cliente: (A - pub) / 1000,
  };
}

function groupOf(w) {
  const A = w.publico + w.cliente;
  return {
    S: +(w.produto + w.servico).toFixed(3),
    D: +w.descricao.toFixed(3),
    A: +A.toFixed(3),
    r: A > 0 ? +(w.publico / A).toFixed(3) : null,
  };
}

function buildConfigs() {
  const out = [];
  for (let s = 1; s <= 8; s++) {
    for (let d = 0; d <= 5; d++) {
      const S = s * 100;
      const D = d * 100;
      const A = 1000 - S - D;
      if (A < 0) continue;
      for (const r of A > 0 ? RATIOS : [null]) {
        const weights = weightsFromMille(S, D, A, r ?? 0);
        out.push({ id: `S${S / 1000}_D${D / 1000}_A${A / 1000}${r != null ? `_r${r}` : ""}`, grid: true, weights, group: groupOf(weights) });
      }
    }
  }
  for (const [name, w] of Object.entries(WEIGHT_PRESETS)) {
    out.push({ id: `atual_${name}`, grid: false, weights: { ...w }, group: groupOf(w) });
  }
  return out;
}

const CONFIGS = buildConfigs();

// ---------------------------------------------------------------- utilitários

async function runPool(items, worker, label) {
  let next = 0;
  let done = 0;
  const total = items.length;
  if (!total) return;
  async function loop() {
    while (next < total) {
      const item = items[next++];
      await worker(item);
      done++;
      if (done % 100 === 0 || done === total) rawLog(`  ${label}: ${done}/${total}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, loop));
}

async function withRetry(fn, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 800 * i * i));
    }
  }
}

const asText = (v, max) => {
  const s = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
  return s.replace(/\s+/g, " ").trim().slice(0, max);
};

function compactCompany(payload = {}) {
  return {
    nome: asText(payload.nome_empresa, 120),
    industria: asText(payload.industria, 120),
    produto: asText(payload.produto, 220),
    servico: asText(payload.servico, 220),
    descricao: asText(payload.descricao, 260),
    publico: asText(payload.publico, 200),
    cliente: asText(payload.cliente, 160),
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const fmt = (x, d = 3) => (x == null ? "-" : Number(x).toFixed(d));
const fmtWeights = (w) => `p ${fmt(w.produto)} · s ${fmt(w.servico)} · d ${fmt(w.descricao)} · pub ${fmt(w.publico)} · cli ${fmt(w.cliente)}`;

// ---------------------------------------------------------------- fase 1: buscas

async function runSearches(jobs, label) {
  const pending = jobs.filter((j) => !searches[j.key]);
  rawLog(`${label}: ${pending.length} buscas pendentes (${jobs.length - pending.length} em cache)`);
  let sinceSave = 0;
  await runPool(
    pending,
    async (job) => {
      const res = await withRetry(() => executeSearchByText(job.body));
      const ids = [];
      for (const item of res.results || []) {
        const id = String(item.id ?? item.payload?.cnpj ?? item.payload?.nome_empresa);
        ids.push(id);
        if (!companies[id]) companies[id] = compactCompany(item.payload);
      }
      searches[job.key] = { ids, bm25: res.weights_used?.bm25 ?? 0, weights_used: res.weights_used };
      if (++sinceSave >= 150) {
        sinceSave = 0;
        saveJson("searches.json", searches);
        saveJson("companies.json", companies);
      }
    },
    label,
  );
  saveJson("searches.json", searches);
  saveJson("companies.json", companies);
}

function gridJobs() {
  return queries.flatMap((q) =>
    CONFIGS.map((cfg) => ({
      key: `${q.qid}|${cfg.id}|mista`,
      body: { query: q.text, weights: cfg.weights, final_limit: TOP_K },
    })),
  );
}

// ---------------------------------------------------------------- fase 2: juiz

let openai = null;
function getOpenAI() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

function judgePrompt(fam, ids) {
  const lines = ids.map((id, i) => {
    const c = companies[id] || {};
    return `[${i + 1}] ${c.nome} | Indústria: ${c.industria || "-"} | Produtos: ${c.produto || "-"} | Serviços: ${c.servico || "-"} | Descrição: ${c.descricao || "-"} | Público-alvo: ${c.publico || "-"} | Clientes: ${c.cliente || "-"}`;
  });
  return `Você avalia fornecedores B2B para um comprador do setor de construção civil.

O comprador busca:
- ESCOPO (o que ele quer comprar/contratar): ${fam.escopo}
- PÚBLICO (perfil do comprador, que o fornecedor deveria atender): ${fam.publico}
Exemplos de como ele escreveu a busca: ${fam.variations.map((v) => `"${v}"`).join("; ")}

Para cada empresa, dê duas notas inteiras de 0 a 3, independentes entre si:
escopo:
 3 = fornece exatamente esse produto/serviço como atividade principal
 2 = fornece esse item entre outros, ou algo muito próximo/substituto direto
 1 = mesmo setor ou item relacionado, mas não fornece o que foi pedido
 0 = sem relação
publico:
 3 = atende explicitamente esse perfil de cliente (citado no público-alvo ou clientes)
 2 = atende um público próximo ou abrangente que claramente inclui esse perfil
 1 = público genérico ("empresas", "consumidor final") ou só parcialmente compatível
 0 = público incompatível ou sem nenhuma informação

EMPRESAS:
${lines.join("\n")}

Responda apenas JSON: {"avaliacoes":[{"n":1,"escopo":0,"publico":0}, ...]} com todas as ${ids.length} empresas.`;
}

async function judgeBatch(fam, ids) {
  const response = await getOpenAI().chat.completions.create({
    model: JUDGE_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: judgePrompt(fam, ids) }],
  });
  const parsed = JSON.parse(response.choices?.[0]?.message?.content || "{}");
  const list = Array.isArray(parsed.avaliacoes) ? parsed.avaliacoes : [];
  const clamp = (v) => Math.max(0, Math.min(3, Math.round(Number(v) || 0)));
  let got = 0;
  for (const row of list) {
    const id = ids[Number(row.n) - 1];
    if (!id) continue;
    judgments[`${fam.id}|${id}`] = { e: clamp(row.escopo), p: clamp(row.publico) };
    got++;
  }
  if (got < ids.length) throw new Error(`juiz retornou ${got}/${ids.length}`);
}

async function runJudge(label) {
  const batches = [];
  for (const fam of families) {
    const ids = new Set();
    for (const [key, s] of Object.entries(searches)) {
      if (key.split("#")[0] === fam.id) s.ids.forEach((id) => ids.add(id));
    }
    const pending = [...ids].filter((id) => !judgments[`${fam.id}|${id}`]);
    for (let i = 0; i < pending.length; i += JUDGE_BATCH) batches.push({ fam, ids: pending.slice(i, i + JUDGE_BATCH) });
  }
  rawLog(`${label}: ${batches.length} lotes para o juiz (${JUDGE_MODEL})`);
  await runPool(
    batches,
    async (b) => {
      await withRetry(() => judgeBatch(b.fam, b.ids));
      saveJson("judgments.json", judgments);
    },
    label,
  );
  saveJson("judgments.json", judgments);
}

// ---------------------------------------------------------------- fase 3: score

function idealDcg(famId, gainFn) {
  const gains = Object.entries(judgments)
    .filter(([k]) => k.startsWith(`${famId}|`))
    .map(([, j]) => gainFn(j))
    .sort((a, b) => b - a)
    .slice(0, TOP_K);
  return gains.reduce((acc, g, i) => acc + g / Math.log2(i + 2), 0);
}

const idealCache = new Map();
function ndcg(famId, ids, preset) {
  const gainFn = GAINS[preset];
  const cacheKey = `${famId}|${preset}`;
  if (!idealCache.has(cacheKey)) idealCache.set(cacheKey, idealDcg(famId, gainFn));
  const ideal = idealCache.get(cacheKey);
  if (!ideal) return 0;
  const dcg = ids.slice(0, TOP_K).reduce((acc, id, i) => {
    const j = judgments[`${famId}|${id}`];
    return acc + (j ? gainFn(j) : 0) / Math.log2(i + 2);
  }, 0);
  return dcg / ideal;
}

function precisionAt(famId, ids, k, test) {
  const top = ids.slice(0, k);
  return top.filter((id) => {
    const j = judgments[`${famId}|${id}`];
    return j && test(j);
  }).length / k;
}

/** matrix[preset][configId][famId] = [nDCG por variação] */
function scoreMatrix(configs, focusTag) {
  const matrix = Object.fromEntries(PRESET_NAMES.map((p) => [p, {}]));
  for (const cfg of configs) {
    for (const p of PRESET_NAMES) matrix[p][cfg.id] = {};
    for (const q of queries) {
      const s = searches[`${q.qid}|${cfg.id}|${focusTag(q)}`];
      if (!s) continue;
      for (const p of PRESET_NAMES) {
        (matrix[p][cfg.id][q.fam.id] ||= []).push(ndcg(q.fam.id, s.ids, p));
      }
    }
  }
  return matrix;
}

function neighborsOf(cfg, gridConfigs) {
  const ri = (r) => (r == null ? null : RATIOS.indexOf(r));
  return gridConfigs.filter((o) => {
    if (o.id === cfg.id) return false;
    const dS = Math.abs(o.group.S - cfg.group.S);
    const dD = Math.abs(o.group.D - cfg.group.D);
    if (dS > 0.101 || dD > 0.101) return false;
    const a = ri(cfg.group.r);
    const b = ri(o.group.r);
    return a == null || b == null || Math.abs(a - b) <= 1;
  });
}

function runScore() {
  const grid = CONFIGS.filter((c) => c.grid);
  const matrix = scoreMatrix(CONFIGS, () => "mista");
  const famIds = families.map((f) => f.id);
  const summary = {};

  for (const preset of PRESET_NAMES) {
    const rows = CONFIGS.map((cfg) => {
      const perFam = matrix[preset][cfg.id];
      const famMeans = famIds.map((f) => mean(perFam[f] || []));
      const variationStd = mean(famIds.map((f) => std(perFam[f] || [])));
      return { cfg, score: mean(famMeans), famMeans, variationStd };
    });
    const byId = Object.fromEntries(rows.map((r) => [r.cfg.id, r]));
    for (const row of rows) {
      if (!row.cfg.grid) {
        row.smoothed = null;
        continue;
      }
      const neigh = neighborsOf(row.cfg, grid);
      row.smoothed = mean([row.score, ...neigh.map((n) => byId[n.id].score)]);
      row.neighbors = neigh.length;
    }

    const wins = {};
    const gridRows = rows.filter((r) => r.cfg.grid);
    for (let b = 0; b < BOOTSTRAP_ROUNDS; b++) {
      const sample = famIds.map(() => Math.floor(Math.random() * famIds.length));
      let best = null;
      let bestScore = -1;
      for (const row of gridRows) {
        const sc = mean(sample.map((i) => row.famMeans[i]));
        if (sc > bestScore) {
          bestScore = sc;
          best = row.cfg.id;
        }
      }
      wins[best] = (wins[best] || 0) + 1;
    }
    for (const row of rows) row.bootstrap = (wins[row.cfg.id] || 0) / BOOTSTRAP_ROUNDS;

    const ranked = [...gridRows].sort((a, b) => b.smoothed - a.smoothed);
    const famWinners = famIds.map((f, i) => {
      const best = [...gridRows].sort((a, b) => b.famMeans[i] - a.famMeans[i])[0];
      return { family: f, best: best.cfg.id, group: best.cfg.group, score: best.famMeans[i] };
    });

    summary[preset] = {
      recommended: ranked[0].cfg,
      top: ranked.slice(0, 12).map((r) => ({
        id: r.cfg.id,
        weights: r.cfg.weights,
        group: r.cfg.group,
        score: r.score,
        smoothed: r.smoothed,
        bootstrap: r.bootstrap,
        variationStd: r.variationStd,
      })),
      bestRaw: [...gridRows].sort((a, b) => b.score - a.score)[0].cfg.id,
      current: Object.fromEntries(
        PRESET_NAMES.map((n) => [n, { score: byId[`atual_${n}`].score, variationStd: byId[`atual_${n}`].variationStd }]),
      ),
      equalWeights: byId["S0.4_D0.2_A0.4_r0.5"].score,
      famWinners,
      groupMarginals: marginals(gridRows),
    };
  }

  const tradeoff = tradeoffTable(grid);
  const bestScope = Math.max(...tradeoff.map((t) => t.scopeSmoothed));
  const frontier = tradeoff
    .filter((t) => !tradeoff.some((o) => o.pScope >= t.pScope && o.pAudience >= t.pAudience && (o.pScope > t.pScope || o.pAudience > t.pAudience)))
    .sort((a, b) => b.pScope - a.pScope);
  const audienceChoice = (tolerance) =>
    tradeoff.filter((t) => t.scopeSmoothed >= bestScope * (1 - tolerance)).sort((a, b) => b.audienceSmoothed - a.audienceSmoothed)[0];
  const maxPScope = Math.max(...frontier.map((f) => f.pScope));
  const publicoPick = frontier
    .filter((f) => f.pScope >= maxPScope * (1 - SCOPE_LOSS_TOLERANCE))
    .sort((a, b) => b.pAudience - a.pAudience)[0];
  const escopoPick = summary.escopo.recommended.weights;
  const avg = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, +((a[k] + b[k]) / 2).toFixed(4)]));
  summary.recommendations = {
    escopo: { rule: "maior nDCG@10 de escopo suavizado na grade", source: summary.escopo.recommended.id, weights: escopoPick },
    publico_alvo: {
      rule: `fronteira: maior P@10 de público perdendo no máximo ${SCOPE_LOSS_TOLERANCE * 100}% de P@10 de escopo`,
      source: publicoPick.id,
      weights: publicoPick.weights,
    },
    equilibrado: { rule: "ponto médio entre escopo e publico_alvo", source: "média", weights: avg(escopoPick, publicoPick.weights) },
  };
  summary.tradeoff = {
    frontier,
    publicoAlvoAt3pct: audienceChoice(0.03),
    publicoAlvoAt5pct: audienceChoice(0.05),
    publicoAlvoAt8pct: audienceChoice(0.08),
    current: Object.fromEntries(PRESET_NAMES.map((n) => [n, tradeoffRow(CONFIGS.find((c) => c.id === `atual_${n}`))])),
  };
  printTradeoff(summary.tradeoff);
  rawLog("\n## Recomendações");
  for (const [n, r] of Object.entries(summary.recommendations)) rawLog(`   ${n.padEnd(13)} ${r.source.padEnd(22)} [${fmtWeights(r.weights)}]  (${r.rule})`);

  const bm25Share = mean(Object.values(searches).map((s) => (s.bm25 > 0 ? 1 : 0)));
  const judged = Object.values(judgments);
  const stats = {
    queries: queries.length,
    families: families.length,
    configs: CONFIGS.length,
    searches: Object.keys(searches).length,
    judgedPairs: judged.length,
    bm25ActiveShare: bm25Share,
    escopoDist: [0, 1, 2, 3].map((g) => judged.filter((j) => j.e === g).length),
    publicoDist: [0, 1, 2, 3].map((g) => judged.filter((j) => j.p === g).length),
  };
  saveJson("summary.json", { stats, summary, judgeModel: JUDGE_MODEL, gains: Object.fromEntries(Object.entries(GAINS).map(([k, f]) => [k, f.toString()])) });
  printSummary(stats, summary);
  return summary;
}

/**
 * pScope    = fração do top 10 com escopo >= 2
 * pAudience = fração do top 10 com escopo >= 2 e público = 3 (atende explicitamente o perfil do comprador)
 */
function tradeoffRow(cfg) {
  const scope = [];
  const audience = [];
  const ndcgScope = [];
  for (const q of queries) {
    const s = searches[`${q.qid}|${cfg.id}|mista`];
    if (!s) continue;
    scope.push(precisionAt(q.fam.id, s.ids, TOP_K, (j) => j.e >= 2));
    audience.push(precisionAt(q.fam.id, s.ids, TOP_K, (j) => j.e >= 2 && j.p === 3));
    ndcgScope.push(ndcg(q.fam.id, s.ids, "escopo"));
  }
  return { id: cfg.id, weights: cfg.weights, group: cfg.group, pScope: mean(scope), pAudience: mean(audience), ndcgScope: mean(ndcgScope) };
}

function tradeoffTable(grid) {
  const rows = grid.map(tradeoffRow);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  for (const row of rows) {
    const neigh = neighborsOf(grid.find((c) => c.id === row.id), grid).map((n) => byId[n.id]);
    row.scopeSmoothed = mean([row.ndcgScope, ...neigh.map((n) => n.ndcgScope)]);
    row.audienceSmoothed = mean([row.pAudience, ...neigh.map((n) => n.pAudience)]);
  }
  return rows;
}

function printTradeoff(t) {
  rawLog("\n## Fronteira escopo x público (P@10 escopo≥2  |  P@10 escopo≥2 & público=3)");
  for (const r of t.frontier) rawLog(`   ${r.id.padEnd(22)} escopo ${fmt(r.pScope)}  público ${fmt(r.pAudience)}  nDCG-esc ${fmt(r.ndcgScope)}`);
  for (const [n, r] of Object.entries(t.current)) rawLog(`   atual_${n.padEnd(16)} escopo ${fmt(r.pScope)}  público ${fmt(r.pAudience)}  nDCG-esc ${fmt(r.ndcgScope)}`);
  for (const k of ["publicoAlvoAt3pct", "publicoAlvoAt5pct", "publicoAlvoAt8pct"]) {
    const r = t[k];
    rawLog(`   ${k}: ${r.id}  escopo ${fmt(r.pScope)} público ${fmt(r.pAudience)} (suav esc ${fmt(r.scopeSmoothed)} pub ${fmt(r.audienceSmoothed)})`);
  }
}

/** Média do score agrupada por S, D, A e r — mostra a forma da superfície. */
function marginals(gridRows) {
  const out = {};
  for (const dim of ["S", "D", "A", "r"]) {
    const buckets = {};
    for (const row of gridRows) {
      const v = row.cfg.group[dim];
      if (v == null) continue;
      (buckets[v] ||= []).push(row.score);
    }
    out[dim] = Object.fromEntries(
      Object.entries(buckets)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([v, xs]) => [v, { mean: mean(xs), max: Math.max(...xs) }]),
    );
  }
  return out;
}

function printSummary(stats, summary) {
  rawLog("\n================ RESUMO ================");
  rawLog(JSON.stringify(stats));
  for (const preset of PRESET_NAMES) {
    const s = summary[preset];
    rawLog(`\n## ${preset}  (melhor bruto: ${s.bestRaw})`);
    rawLog(`   pesos iguais: ${fmt(s.equalWeights)} | atual_escopo ${fmt(s.current.escopo.score)} | atual_publico_alvo ${fmt(s.current.publico_alvo.score)} | atual_equilibrado ${fmt(s.current.equilibrado.score)}`);
    for (const r of s.top.slice(0, 8)) {
      rawLog(`   ${r.id.padEnd(22)} nDCG ${fmt(r.score)}  suav ${fmt(r.smoothed)}  boot ${fmt(r.bootstrap, 2)}  σvar ${fmt(r.variationStd)}`);
    }
    for (const dim of ["S", "D", "A", "r"]) {
      rawLog(`   marginal ${dim}: ${Object.entries(s.groupMarginals[dim]).map(([v, m]) => `${v}→${fmt(m.mean)}/${fmt(m.max)}`).join("  ")}`);
    }
  }
}

// ---------------------------------------------------------------- fase 4: validação com search_focus

async function runValidate() {
  const summaryFile = loadJson("summary.json", null);
  if (!summaryFile?.summary?.recommendations) throw new Error("Rode a fase score antes de validate");
  const candidates = [];
  for (const preset of PRESET_NAMES) {
    candidates.push({ id: `atual_${preset}`, preset, weights: WEIGHT_PRESETS[preset] });
    candidates.push({ id: `rec_${preset}`, preset, weights: summaryFile.summary.recommendations[preset].weights });
  }
  candidates.push({ id: "pesos_iguais", preset: "-", weights: { produto: 0.2, servico: 0.2, descricao: 0.2, publico: 0.2, cliente: 0.2 } });
  const jobs = queries.flatMap((q) =>
    candidates.map((c) => ({
      key: `${q.qid}|${c.id}|${q.fam.focus}`,
      body: { query: q.text, weights: c.weights, search_focus: q.fam.focus, final_limit: TOP_K },
    })),
  );
  await runSearches(jobs, "validate/search");
  await runJudge("validate/judge");
  idealCache.clear();

  const rows = [];
  for (const c of candidates) {
    const per = { escopo: [], publico_alvo: [], equilibrado: [], p5_escopo: [], p5_publico: [] };
    for (const q of queries) {
      const s = searches[`${q.qid}|${c.id}|${q.fam.focus}`];
      if (!s) continue;
      for (const p of PRESET_NAMES) per[p].push(ndcg(q.fam.id, s.ids, p));
      per.p5_escopo.push(precisionAt(q.fam.id, s.ids, 5, (j) => j.e >= 2));
      per.p5_publico.push(precisionAt(q.fam.id, s.ids, 5, (j) => j.e >= 2 && j.p >= 2));
    }
    rows.push({
      id: c.id,
      preset: c.preset,
      weights: c.weights,
      ndcg: Object.fromEntries(PRESET_NAMES.map((p) => [p, mean(per[p])])),
      p5_escopo: mean(per.p5_escopo),
      p5_escopo_publico: mean(per.p5_publico),
    });
  }
  saveJson("validation.json", rows);
  rawLog("\n================ VALIDAÇÃO (search_focus da família) ================");
  for (const r of rows) {
    rawLog(
      `${r.id.padEnd(22)} [${fmtWeights(r.weights)}]  nDCG esc ${fmt(r.ndcg.escopo)} pub ${fmt(r.ndcg.publico_alvo)} eq ${fmt(r.ndcg.equilibrado)} | P@5 esc ${fmt(r.p5_escopo, 2)} esc+pub ${fmt(r.p5_escopo_publico, 2)}`,
    );
  }
}

// ---------------------------------------------------------------- main

rawLog(`Dataset: ${path.basename(DATASET_PATH)} | ${families.length} famílias, ${queries.length} queries, ${CONFIGS.length} configs`);
if (PHASES.includes("search")) await runSearches(gridJobs(), "grid/search");
if (PHASES.includes("judge")) await runJudge("grid/judge");
if (PHASES.includes("score")) runScore();
if (PHASES.includes("validate")) await runValidate();
process.exit(0);
