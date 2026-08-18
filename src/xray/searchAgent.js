import OpenAI from "openai";
import { fetchCitiesNearby, collectUfsFromNearby } from "../clients/citiesApi.js";
import { detectQuerySpecificity, mergeBm25Query, resolveExactTerms } from "../search/bm25Query.js";

/**
 * Pré-proxy X-Ray = Query Manager B2B + bridge para tool MCP search_text.
 * Pesos fixos e regras BM25 discriminantes — alinhado ao prompt de produção.
 * Geo: API-busca-cidades → filter.cidade = lista de nomes.
 */

const MODEL = process.env.LLM_SEARCH_AGENT_MODEL || process.env.LLM_RERANK_MODEL || "gpt-4o-mini";

export const MODELO_NEGOCIO_ALLOWED = [
  "Fabricante",
  "Distribuidor",
  "Atacado",
  "Varejo",
  "Prestador de Serviço",
];

/** Nomes de estado (pt-BR) → sigla UF. */
const UF_BY_NAME = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito federal": "DF",
  "espirito santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

const UF_CODES = new Set(Object.values(UF_BY_NAME));

/** Pesos fixos do Query Manager (soma = 1.0). */
export const QM_FIXED = {
  bm25: 0.2,
  descricao: 0.15,
  publico: 0.03,
  cliente: 0.02,
  nucleo: 0.6,
};

/**
 * Normaliza UF(s) para siglas de 2 letras.
 * Aceita: "SP", "SP,RJ", "SP RJ", "Minas Gerais", ["SP","RJ"], "sp e rj".
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeUfList(raw) {
  if (raw == null || raw === "") return [];

  const parts = [];
  const pushToken = (t) => {
    if (typeof t !== "string") return;
    const s = t
      .trim()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/\s+/g, " ");
    if (!s) return;
    parts.push(s);
  };

  if (Array.isArray(raw)) {
    for (const item of raw) pushToken(String(item));
  } else if (typeof raw === "string") {
    const split = raw
      .split(/[,;/|]+|\s+e\s+|\s+ou\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (split.length > 1) {
      for (const s of split) pushToken(s);
    } else {
      pushToken(raw);
    }
  } else {
    return [];
  }

  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const upper = part.toUpperCase();
    let code = null;
    if (/^[A-Z]{2}$/.test(upper) && UF_CODES.has(upper)) {
      code = upper;
    } else {
      const key = part.toLowerCase();
      code = UF_BY_NAME[key] || null;
    }
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

/** Formata lista de UFs para filter Qdrant (escalar ou array OR). */
export function formatUfFilterValue(ufs) {
  if (!Array.isArray(ufs) || ufs.length === 0) return null;
  return ufs.length === 1 ? ufs[0] : ufs;
}

export const QM_NUCLEO = {
  PRODUTO: { produto: 0.45, servico: 0.15 },
  SERVICO: { produto: 0.15, servico: 0.45 },
  MISTO: { produto: 0.3, servico: 0.3 },
};

let _client = null;
function getClient() {
  if (!_client) {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      const err = new Error("OPENAI_API_KEY não configurado; necessário para o agente X-Ray");
      err.status = 503;
      throw err;
    }
    _client = new OpenAI({ apiKey: key });
  }
  return _client;
}

/** Resolve chaves reais da coleção (produto/servico/…) a partir de aliases do QM. */
export function resolveDimMap(dimensionKeys = []) {
  const keys = dimensionKeys.length
    ? dimensionKeys
    : ["produto", "servico", "descricao", "publico", "cliente"];

  const find = (...preds) => keys.find((k) => preds.some((p) => p(k.toLowerCase()))) || null;

  return {
    produto: find((k) => k.includes("produt")) || "produto",
    servico: find((k) => k.includes("servic")) || "servico",
    descricao: find((k) => k.includes("descric")) || "descricao",
    publico: find((k) => k.includes("public")) || "publico",
    cliente: find((k) => k.includes("client")) || "cliente",
  };
}

/**
 * @param {'PRODUTO'|'SERVICO'|'MISTO'} intent
 * @param {ReturnType<typeof resolveDimMap>} dimMap
 * @param {boolean} includeBm25
 */
export function buildFixedWeights(intent, dimMap, includeBm25 = true) {
  const nucleo = QM_NUCLEO[intent] || QM_NUCLEO.PRODUTO;
  const weights = {
    [dimMap.produto]: nucleo.produto,
    [dimMap.servico]: nucleo.servico,
    [dimMap.descricao]: QM_FIXED.descricao,
    [dimMap.publico]: QM_FIXED.publico,
    [dimMap.cliente]: QM_FIXED.cliente,
  };
  if (includeBm25) weights.bm25 = QM_FIXED.bm25;
  // Corrige residual de arredondamento no núcleo produto
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const delta = Number((1 - sum).toFixed(6));
  if (Math.abs(delta) > 0) {
    weights[dimMap.produto] = Number((weights[dimMap.produto] + delta).toFixed(6));
  }
  return weights;
}

/**
 * Zera peso de dimensões sem texto de query e renormaliza o restante para 1.
 * BM25 só entra se includeBm25 (há bm25_query). Se nada restar, 1.0 vai
 * para a primeira dimensão preenchida ou, em último caso, a primeira chave.
 * @param {Record<string, number>} weights
 * @param {Record<string, string>} [queries]
 * @param {{ includeBm25?: boolean }} [options]
 */
export function zeroWeightsWithoutQueries(weights, queries = {}, { includeBm25 = false } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(weights || {})) {
    if (k === "bm25") {
      out.bm25 = includeBm25 ? Math.max(0, Number(v) || 0) : 0;
      continue;
    }
    const filled = typeof queries[k] === "string" && queries[k].trim();
    out[k] = filled ? Math.max(0, Number(v) || 0) : 0;
  }
  if (includeBm25 && !Object.prototype.hasOwnProperty.call(out, "bm25")) {
    out.bm25 = 0;
  }
  if (!includeBm25) delete out.bm25;

  const positive = Object.keys(out).filter((k) => out[k] > 0);
  if (!positive.length) {
    const fallback =
      Object.keys(out).find((k) => k !== "bm25" && typeof queries[k] === "string" && queries[k].trim()) ||
      (includeBm25 ? "bm25" : null) ||
      Object.keys(out).find((k) => k !== "bm25") ||
      Object.keys(out)[0];
    if (fallback) {
      for (const k of Object.keys(out)) out[k] = 0;
      out[fallback] = 1;
    }
    return out;
  }

  const sum = positive.reduce((a, k) => a + out[k], 0);
  for (const k of positive) out[k] = Number((out[k] / sum).toFixed(6));
  const newSum = Object.values(out).reduce((a, b) => a + b, 0);
  out[positive[0]] = Number((out[positive[0]] + (1 - newSum)).toFixed(6));
  return out;
}

function normalizeIntent(raw) {
  const s = String(raw || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (s.includes("MISTO") || s.includes("MIX")) return "MISTO";
  if (s.includes("SERV")) return "SERVICO";
  return "PRODUTO";
}

function pickModeloNegocio(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const t = raw.trim();
  const hit = MODELO_NEGOCIO_ALLOWED.find(
    (m) => m.toLowerCase() === t.toLowerCase(),
  );
  return hit || null;
}

function buildQueryManagerPrompt(userQuery, config, options = {}) {
  const hasBm25 = Boolean(config.bm25?.vector_name);
  const finalLimit = options.final_limit ?? 10;
  const dimMap = resolveDimMap(config.dimension_keys);

  return `ROLE
Especialista em Engenharia de Busca B2B e Hybrid Retrieval (Query Manager).
Sua missão é garantir que o objeto real da busca (o substantivo) seja o filtro dominante,
impedindo que vizinhos semânticos irrelevantes dominem o resultado.

OBJETIVO
Transformar a consulta do usuário em JSON estruturado para busca híbrida dual-path.
A API pode combinar busca léxica (BM25/sparse) + semântica densa (RRF).
Você alimenta os textos densos; BM25 só quando a busca for ESPECÍFICA.

PEDIDO DO USUÁRIO:
"""${userQuery}"""

CONFIG DA API (dimensões reais → use nos textos; pesos densos/BM25 são aplicados pelo servidor):
- Dimensão produto: "${dimMap.produto}"
- Dimensão serviço: "${dimMap.servico}"
- Dimensão descrição: "${dimMap.descricao}"
- Dimensão público: "${dimMap.publico}"
- Dimensão clientes: "${dimMap.cliente}"
- BM25 na coleção: ${hasBm25 ? "SIM" : "NÃO (ainda assim preencha bm25 quando a regra abaixo pedir)"}
- final_limit sugerido: ${finalLimit}

TAREFA: CLASSIFICAÇÃO DE INTENÇÃO + QUANDO USAR BM25

intent = PRODUTO | SERVICO | MISTO

Pesos FIXOS no servidor (soma 1.0):
- Sem BM25: núcleo produto+serviço absorve o 0.20 (descricao=0.15, publico=0.03, clientes=0.02)
- Com BM25: bm25=0.20, descricao=0.15, publico=0.03, clientes=0.02, núcleo=0.60
- PRODUTO → produtos=0.45, servicos=0.15 (com BM25) | ajustado sem BM25
- SERVICO → servicos=0.45, produtos=0.15 (com BM25) | ajustado sem BM25
- MISTO → produtos=0.30, servicos=0.30 (com BM25) | ajustado sem BM25

Exemplos intent:
- "açaí" → PRODUTO
- "proteína bovina hidrolisada" → PRODUTO
- "soldagem de estruturas metálicas" → SERVICO
- "limpeza industrial" → SERVICO
- "instalação de ar condicionado" → MISTO

BM25 — NÃO É OBRIGATÓRIO EM TODA BUSCA, MAS É OBRIGATÓRIO SE HOUVER ESPECIFICIDADE

use_bm25 = true se QUALQUER um destes:
  A) aspas ("...") OU "termo exato" / "busca exata" / "especificamente" / "específico";
  B) cita MODELO, MARCA, SKU, referência, geração ou código
     (ex.: Xiaomi Redmi Note 10, iPhone 16 Pro, iPhone 15, ISO 9001);
  C) nicho técnico (ex.: "impressão 3D", "RPG", "epóxi", "caroço de açaí", "parafuso naval").

NÃO classifique como genérica só porque a região é nacional/estadual ou o texto começa com "preciso de um fornecedor".
"celular Xiaomi modelo Redmi Note 10 especificamente, nacional" → use_bm25=true;
exact_terms: ["Redmi Note 10", "Xiaomi"]; bm25 inclui esses termos.
"Preciso de um fornecedor, para iphone, mais especificamente o iphone 16 pro" → use_bm25=true;
exact_terms: ["iPhone 16 Pro", "iPhone"]; bm25: "iPhone 16 Pro smartphone".

use_bm25 = false SOMENTE se a query for genérica/ampla SEM marca/modelo/SKU
(ex.: "fornecedor de embalagens", "material de escritório", "serviços de limpeza").
Nesse caso: bm25 = "" e exact_terms = [].

Quando use_bm25 = true:
  - Preencha bm25 com APENAS termos discriminantes (sem genérico compartilhado), EXCETO termos exatos.
  - Termos entre aspas → também em exact_terms (nunca remova o termo exato do bm25).
  - O servidor aplica peso_bm25 = 0.20 automaticamente.

Lógica discriminante (quando BM25 ligado):
  a) Identifique o termo que torna a busca específica
  b) Use só variações desse termo e termos técnicos exclusivos
  c) NÃO inclua o genérico compartilhado (exceto se for termo exato entre aspas)
Exemplos:
- "caroço de açaí" → use_bm25=true; bm25: "caroço caroços semente sementes biomassa resíduo" (SEM "açaí")
- "proteína bovina hidrolisada" → use_bm25=true; bm25: "hidrolisada hidrolisado colágeno peptídeo"
- "parafuso para embarcação" → use_bm25=true; bm25: "embarcação embarcações naval náutico marítimo inox"
- "tinta epóxi para piso industrial" → use_bm25=true; bm25: "epóxi piso industrial revestimento resistência"
- fornecedor de "parafuso naval" → use_bm25=true; bm25 inclui "parafuso naval"; exact_terms: ["parafuso naval"]
- "impressão 3D para jogos de tabuleiro e RPG" → use_bm25=true; bm25: "impressão 3D tabuleiro RPG modelagem prototipagem"
- "celular Xiaomi modelo Redmi Note 10 especificamente" → use_bm25=true; exact_terms: ["Redmi Note 10","Xiaomi"]; bm25: "Xiaomi Redmi Note 10 smartphone"
- "Preciso de um fornecedor, para iphone, mais especificamente o iphone 16 pro" → use_bm25=true; exact_terms: ["iPhone 16 Pro","iPhone"]; bm25: "iPhone 16 Pro smartphone"
- "fornecedor de embalagens em SP" → use_bm25=false; bm25: ""

DIRETRIZES DE CONTEÚDO (ANTI-ERRO)

1) Ancoragem de Objeto (denso): em produtos e servicos, o objeto principal deve estar em cada termo.
   Ex.: "Higienização de Big Bags", "Manutenção de Silos".
2) Foco no produto acabado — evite só matéria-prima isolada.
3) Sanitização — remova saudações, "orçamento", "teste".
4) Modelo_Negocio: EXATAMENTE um de ${JSON.stringify(MODELO_NEGOCIO_ALLOWED)}.
5) GEO — cidade (raio) OU UF estadual:
   a) CIDADE / RAIO: cidade_centro, uf (se souber), radius_km (default 50).
   b) SÓ ESTADO / UF: cidade_centro=null, radius_km=null, uf="SP" ou "SP,RJ,MG".
   c) Sem geo: cidade_centro/uf/radius_km = null.
6) PROIBIDO explicar fora do JSON. Retorne APENAS JSON.

SCHEMA DE SAÍDA
{
  "query_original": "string",
  "intent": "PRODUTO|SERVICO|MISTO",
  "reasoning": "2-4 frases do plano Query Manager",
  "produtos": "Objeto + Atributo (max 4 termos, separados por vírgula)",
  "servicos": "Ação + Objeto Específico (max 4 termos)",
  "descricao": "processos e diferenciais técnicos",
  "publico": "string",
  "clientes": "string",
  "use_bm25": true,
  "bm25": "termos discriminantes OU string vazia se use_bm25=false",
  "exact_terms": ["termo entre aspas ou []"],
  "Modelo_Negocio": "um dos valores permitidos",
  "cidade_centro": "string|null",
  "uf": "sigla UF ou lista CSV (ex. SP ou SP,RJ)|null",
  "radius_km": "number|null",
  "rerank": false,
  "debug": false
}`;
}

/**
 * Converte saída do Query Manager → arguments da tool search_text.
 * @param {object} qm
 * @param {object} config
 * @param {{ userQuery?: string, final_limit?: number, debug?: boolean, rerank?: boolean, cityNames?: string[]|null, geoMeta?: object|null, ufs?: string[]|null, exact_terms?: string[]|string }} [options]
 */
export function mapQueryManagerToToolArgs(qm, config, options = {}) {
  const dimMap = resolveDimMap(config.dimension_keys);
  const intent = normalizeIntent(qm.intent);

  const queries = {};
  const put = (apiKey, text) => {
    if (typeof text === "string" && text.trim()) queries[apiKey] = text.trim();
  };
  put(dimMap.produto, qm.produtos);
  put(dimMap.servico, qm.servicos);
  put(dimMap.descricao, qm.descricao);
  put(dimMap.publico, qm.publico);
  put(dimMap.cliente, qm.clientes);

  const query =
    (typeof qm.query_original === "string" && qm.query_original.trim()) ||
    options.userQuery ||
    Object.values(queries)[0] ||
    "";

  const userText = options.userQuery || query;
  const exactTerms = resolveExactTerms({
    exact_terms: options.exact_terms ?? qm.exact_terms,
    userQuery: userText,
  });
  const specificity = detectQuerySpecificity(userText);

  if (exactTerms.length) {
    const extra = exactTerms.join(", ");
    const key = dimMap.produto;
    const current = typeof queries[key] === "string" ? queries[key] : "";
    if (!current) {
      queries[key] = extra;
    } else if (!current.toLowerCase().includes(extra.toLowerCase())) {
      queries[key] = `${current}, ${extra}`;
    }
  }

  // BM25: aspas / termo extraído (modelo, marca, SKU) / nicho do QM / cue "especificamente".
  // Código prevalece se o LLM classificar um modelo específico como busca genérica.
  const qmDisabledBm25 = qm.bm25 === false || qm.bm25 === "false";
  const qmBm25Text =
    typeof qm.bm25 === "string" && qm.bm25.trim() && !qmDisabledBm25
      ? qm.bm25.trim()
      : "";
  const qmWantsBm25 =
    qm.use_bm25 === true ||
    qm.use_bm25 === "true" ||
    qm.use_bm25 === 1 ||
    qm.use_bm25 === "1";
  const includeBm25 =
    exactTerms.length > 0 ||
    Boolean(qmBm25Text) ||
    qmWantsBm25 ||
    specificity.specific;
  const weights = zeroWeightsWithoutQueries(
    buildFixedWeights(intent, dimMap, includeBm25),
    queries,
    { includeBm25 },
  );

  const filter = {};
  const modelo = pickModeloNegocio(qm.Modelo_Negocio ?? qm.modelo_negocio);
  if (modelo) filter.modelo_negocio = modelo;

  // Lista regional (cidade+raio) tem prioridade sobre filtro UF puro
  const cityNames = Array.isArray(options.cityNames)
    ? options.cityNames.filter((n) => typeof n === "string" && n.trim())
    : null;

  const ufsFromOptions = normalizeUfList(options.ufs);
  const ufsFromQm = normalizeUfList(qm.ufs ?? qm.uf);
  const ufs = ufsFromOptions.length ? ufsFromOptions : ufsFromQm;
  const ufFilter = formatUfFilterValue(ufs);

  if (cityNames && cityNames.length > 0) {
    filter.cidade = cityNames.length === 1 ? cityNames[0] : cityNames;
  } else {
    if (ufFilter != null) filter.uf = ufFilter;
    const singleCity =
      (typeof qm.cidade_centro === "string" && qm.cidade_centro.trim()) ||
      (typeof qm.cidade === "string" && qm.cidade.trim()) ||
      null;
    if (singleCity) filter.cidade = singleCity;
  }

  const toolArguments = {
    query,
    weights,
    queries,
    limit_per_vector: 50,
    final_limit:
      Number.isInteger(Number(options.final_limit)) && Number(options.final_limit) >= 1
        ? Number(options.final_limit)
        : 10,
    rerank: Boolean(qm.rerank) || options.rerank === true,
    debug: Boolean(qm.debug) || options.debug === true,
  };

  if (Object.keys(filter).length) toolArguments.filter = filter;
  if (exactTerms.length) toolArguments.exact_terms = exactTerms;

  if (includeBm25) {
    const lexicalCore =
      qmBm25Text || (specificity.terms.length ? specificity.terms.join(" ") : query);
    toolArguments.bm25_query = mergeBm25Query(lexicalCore, exactTerms);
  } else {
    toolArguments.bm25 = false;
  }

  return {
    intent,
    weights_applied: weights,
    dim_map: dimMap,
    toolArguments,
    query_manager: {
      query_original: qm.query_original ?? query,
      intent,
      produtos: qm.produtos ?? null,
      servicos: qm.servicos ?? null,
      descricao: qm.descricao ?? null,
      publico: qm.publico ?? null,
      clientes: qm.clientes ?? null,
      bm25: includeBm25 ? toolArguments.bm25_query : qmBm25Text || (qm.bm25 ?? null),
      exact_terms: exactTerms.length ? exactTerms : null,
      use_bm25: includeBm25,
      Modelo_Negocio: modelo,
      cidade_centro: qm.cidade_centro ?? qm.cidade ?? null,
      uf: ufFilter,
      ufs,
      radius_km: qm.radius_km ?? null,
      peso_produtos: weights[dimMap.produto],
      peso_servicos: weights[dimMap.servico],
      peso_descricao: weights[dimMap.descricao],
      peso_publico: weights[dimMap.publico],
      peso_clientes: weights[dimMap.cliente],
      peso_bm25: includeBm25 ? weights.bm25 : 0,
      geo: options.geoMeta || null,
    },
  };
}

/**
 * Resolve geo de cidade+raio: UI explícita tem prioridade; senão campos do QM.
 * UF-only (sem cidade) → retorna null; use resolveUfFilter.
 * @returns {{ city_name: string, uf: string|null, radius_km: number }|null}
 */
export function resolveGeoRequest(qm = {}, geoFromUi = {}) {
  const uiName =
    typeof geoFromUi.city_name === "string" ? geoFromUi.city_name.trim() : "";
  const qmName =
    (typeof qm.cidade_centro === "string" && qm.cidade_centro.trim()) ||
    (typeof qm.cidade === "string" && qm.cidade.trim()) ||
    "";

  const city_name = uiName || qmName;
  if (!city_name) return null;

  const ufs = normalizeUfList(geoFromUi.uf ?? geoFromUi.ufs ?? qm.ufs ?? qm.uf);
  const uf = ufs.length ? ufs[0] : null;

  let radius_km =
    geoFromUi.radius_km != null && geoFromUi.radius_km !== ""
      ? Number(geoFromUi.radius_km)
      : qm.radius_km != null && qm.radius_km !== ""
        ? Number(qm.radius_km)
        : 50;

  if (!Number.isFinite(radius_km) || radius_km <= 0) radius_km = 50;

  return { city_name, uf, radius_km };
}

/**
 * Resolve filtro estadual (UF) quando não há cidade.
 * UI/agente explícito tem prioridade sobre o QM.
 * @returns {string[]}
 */
export function resolveUfFilter(qm = {}, geoFromUi = {}) {
  const fromUi = normalizeUfList(geoFromUi.uf ?? geoFromUi.ufs);
  if (fromUi.length) return fromUi;
  return normalizeUfList(qm.ufs ?? qm.uf);
}

/**
 * Planeja via Query Manager e monta tool call MCP search_text.
 * @param {string} userQuery
 * @param {object} config
 * @param {{ final_limit?: number, debug?: boolean, rerank?: boolean, exact_terms?: string[]|string, geo?: { city_name?: string, uf?: string|string[], ufs?: string[], radius_km?: number } }} [options]
 */
export async function planSearchToolCall(userQuery, config, options = {}) {
  const query = typeof userQuery === "string" ? userQuery.trim() : "";
  if (!query) {
    const err = new Error("Campo 'query' é obrigatório");
    err.status = 400;
    throw err;
  }

  const client = getClient();
  const prompt = buildQueryManagerPrompt(query, config, options);
  const started = Date.now();

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Você é o Query Manager B2B (Hybrid Retrieval). Responda somente JSON válido, sem markdown.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.15,
    response_format: { type: "json_object" },
  });

  const raw = response.choices?.[0]?.message?.content || "{}";
  let qm;
  try {
    qm = JSON.parse(raw);
  } catch {
    const err = new Error("Query Manager retornou JSON inválido");
    err.status = 502;
    throw err;
  }

  const geoFromUi = options.geo && typeof options.geo === "object" ? options.geo : {};
  const ufsFromUi = normalizeUfList(geoFromUi.uf ?? geoFromUi.ufs);
  const uiCity =
    typeof geoFromUi.city_name === "string" ? geoFromUi.city_name.trim() : "";
  // Agente/UI pediu só UF (sem cidade) → força filtro estadual; não expandir cidade inventada pelo QM
  const forceUfOnly = !uiCity && ufsFromUi.length > 0;

  // Geo cidade+raio → API cidades → filter.cidade
  let cityNames = null;
  let geoMeta = null;
  const geoReq = forceUfOnly ? null : resolveGeoRequest(qm, geoFromUi);
  if (geoReq) {
    try {
      const nearby = await fetchCitiesNearby(geoReq);
      cityNames = nearby.city_names;
      const radiusUfs = nearby.ufs?.length
        ? nearby.ufs
        : collectUfsFromNearby(nearby);
      geoMeta = {
        city_name: geoReq.city_name,
        uf: radiusUfs.length === 1 ? radiusUfs[0] : geoReq.uf,
        ufs: radiusUfs.length ? radiusUfs : geoReq.uf ? [geoReq.uf] : null,
        radius_km: nearby.radius_km,
        total_found: nearby.total_found,
        cities_in_filter: cityNames.length,
        truncated: nearby.truncated,
        center_city: nearby.center_city,
        city_names_sample: cityNames.slice(0, 15),
        cities_api: nearby.source,
        scope: "cidade",
      };
    } catch (geoErr) {
      geoMeta = {
        city_name: geoReq.city_name,
        uf: geoReq.uf,
        radius_km: geoReq.radius_km,
        error: geoErr.message || String(geoErr),
        status: geoErr.status,
        scope: "cidade",
      };
      // Fallback: filtra só a cidade centro se a API falhar
      cityNames = [geoReq.city_name];
    }
  }

  // UF-only (sem cidade): filter.uf no Qdrant — 1 ou N estados (OR)
  const ufsExplicit = forceUfOnly
    ? ufsFromUi
    : resolveUfFilter(qm, geoFromUi);
  if (!cityNames?.length && ufsExplicit.length) {
    const ufFilter = formatUfFilterValue(ufsExplicit);
    geoMeta = {
      city_name: null,
      uf: ufFilter,
      ufs: ufsExplicit,
      radius_km: null,
      cities_in_filter: 0,
      scope: "uf",
    };
  }

  const mapped = mapQueryManagerToToolArgs(qm, config, {
    ...options,
    userQuery: query,
    cityNames,
    geoMeta,
    ufs: !cityNames?.length && ufsExplicit.length ? ufsExplicit : undefined,
  });

  const geoNote = geoMeta
    ? geoMeta.error
      ? ` · geo falhou (${geoMeta.error}); filtro só "${geoMeta.city_name}"`
      : geoMeta.scope === "uf"
        ? ` · filtro UF ${Array.isArray(geoMeta.uf) ? geoMeta.uf.join(",") : geoMeta.uf}`
        : ` · regional ${geoMeta.city_name}${geoMeta.uf ? "/" + geoMeta.uf : ""} ${geoMeta.radius_km}km → ${geoMeta.cities_in_filter} cidades`
    : "";

  return {
    model: MODEL,
    duration_ms: Date.now() - started,
    tokens_used: response.usage
      ? {
          prompt: response.usage.prompt_tokens,
          completion: response.usage.completion_tokens,
          total: response.usage.total_tokens,
        }
      : null,
    reasoning:
      (typeof qm.reasoning === "string" ? qm.reasoning : `Query Manager · intent ${mapped.intent}`) +
      geoNote,
    user_query: query,
    intent: mapped.intent,
    query_manager: mapped.query_manager,
    geo: geoMeta,
    simulation: {
      client: "query-manager → microsoft-copilot-mcp-preview",
      role: "Query Manager B2B Hybrid Retrieval + Cities API",
      tools_available: ["get_config", "search_text", "cities_nearby (HTTP)"],
      transport: "same-process (X-Ray) → produção usará Streamable HTTP /mcp",
      weights_policy: "fixed-by-intent (PRODUTO|SERVICO|MISTO)",
      regional_filter: Boolean(cityNames?.length),
      uf_filter: Boolean(
        mapped.toolArguments?.filter?.uf != null &&
          mapped.toolArguments.filter.uf !== "",
      ),
    },
    mcp_tool_call: {
      name: "search_text",
      arguments: mapped.toolArguments,
    },
  };
}

/** Planeja + executa (mesma lógica da tool MCP). */
export async function runAgentSearch({
  userQuery,
  config,
  executeSearchByText,
  final_limit,
  debug,
  rerank,
  geo,
}) {
  const plan = await planSearchToolCall(userQuery, config, {
    final_limit,
    debug,
    rerank,
    geo,
  });
  const searchStarted = Date.now();
  const search = await executeSearchByText(plan.mcp_tool_call.arguments, {
    debug: plan.mcp_tool_call.arguments.debug === true,
    rerank: plan.mcp_tool_call.arguments.rerank === true,
  });
  return {
    ...plan,
    search_duration_ms: Date.now() - searchStarted,
    search,
  };
}

/**
 * Monta arguments de search_text a partir de parâmetros explícitos da UI
 * (sem Query Manager). Geo cidade+raio ainda passa pela API de cidades.
 * @param {object} params
 * @param {object} [config]
 * @param {{ final_limit?: number, debug?: boolean, rerank?: boolean }} [options]
 */
export async function planSearchFromParams(params = {}, config = {}, options = {}) {
  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (!query) {
    const err = new Error("Campo 'query' é obrigatório");
    err.status = 400;
    throw err;
  }

  const dimMap = resolveDimMap(config.dimension_keys);
  const dimensionKeys = Array.isArray(config.dimension_keys) && config.dimension_keys.length
    ? config.dimension_keys
    : ["produto", "servico", "descricao", "publico", "cliente"];

  const incoming = params.queries && typeof params.queries === "object" ? params.queries : {};
  const queries = {};
  for (const key of dimensionKeys) {
    const t = incoming[key];
    if (typeof t === "string" && t.trim()) queries[key] = t.trim();
  }

  const keywords =
    typeof params.bm25_query === "string" ? params.bm25_query.trim() : "";
  const includeBm25 = params.bm25 !== false && Boolean(keywords);

  const weights = zeroWeightsWithoutQueries(
    coerceWeightMap(
      params.weights && typeof params.weights === "object" ? params.weights : {},
      dimensionKeys,
      includeBm25,
    ),
    queries,
    { includeBm25 },
  );

  const modelo = pickModeloNegocio(params.modelo_negocio);
  const filter = {};
  if (modelo) filter.modelo_negocio = modelo;

  const cityName = typeof params.city_name === "string" ? params.city_name.trim() : "";
  const ufs = normalizeUfList(params.uf ?? params.ufs);
  const ufFilter = formatUfFilterValue(ufs);
  let radiusKm =
    params.radius_km != null && params.radius_km !== ""
      ? Number(params.radius_km)
      : null;
  if (!Number.isFinite(radiusKm) || radiusKm < 0) radiusKm = null;

  let cityNames = null;
  let geoMeta = null;

  if (cityName && radiusKm != null && radiusKm > 0) {
    const geoReq = {
      city_name: cityName,
      uf: ufs.length ? ufs[0] : null,
      radius_km: radiusKm,
    };
    try {
      const nearby = await fetchCitiesNearby(geoReq);
      cityNames = nearby.city_names;
      const radiusUfs = nearby.ufs?.length
        ? nearby.ufs
        : collectUfsFromNearby(nearby);
      geoMeta = {
        city_name: cityName,
        uf: radiusUfs.length === 1 ? radiusUfs[0] : geoReq.uf,
        ufs: radiusUfs.length ? radiusUfs : ufs.length ? ufs : null,
        radius_km: nearby.radius_km,
        total_found: nearby.total_found,
        cities_in_filter: cityNames.length,
        truncated: nearby.truncated,
        center_city: nearby.center_city,
        city_names_sample: cityNames.slice(0, 15),
        cities_api: nearby.source,
        scope: "cidade",
      };
    } catch (geoErr) {
      geoMeta = {
        city_name: cityName,
        uf: geoReq.uf,
        ufs: ufs.length ? ufs : null,
        radius_km: radiusKm,
        error: geoErr.message || String(geoErr),
        status: geoErr.status,
        scope: "cidade",
      };
      cityNames = [cityName];
    }
  } else if (cityName) {
    cityNames = [cityName];
    geoMeta = {
      city_name: cityName,
      uf: ufs.length ? ufs[0] : null,
      ufs: ufs.length ? ufs : null,
      radius_km: radiusKm === 0 ? 0 : null,
      cities_in_filter: 1,
      city_names_sample: [cityName],
      scope: "cidade",
    };
  } else if (ufs.length) {
    geoMeta = {
      city_name: null,
      uf: ufFilter,
      ufs,
      radius_km: null,
      cities_in_filter: 0,
      scope: "uf",
    };
  } else {
    geoMeta = {
      city_name: null,
      uf: null,
      ufs: null,
      radius_km: null,
      cities_in_filter: 0,
      scope: "nacional",
    };
  }

  if (cityNames && cityNames.length > 0) {
    filter.cidade = cityNames.length === 1 ? cityNames[0] : cityNames;
  } else if (ufFilter != null) {
    filter.uf = ufFilter;
  }

  const exactTerms = Array.isArray(params.exact_terms)
    ? params.exact_terms.map((t) => String(t).trim()).filter(Boolean)
    : typeof params.exact_terms === "string" && params.exact_terms.trim()
      ? [params.exact_terms.trim()]
      : [];

  const toolArguments = {
    query,
    weights,
    queries,
    limit_per_vector: 50,
    final_limit:
      Number.isInteger(Number(options.final_limit)) && Number(options.final_limit) >= 1
        ? Number(options.final_limit)
        : 10,
    rerank: options.rerank === true,
    debug: options.debug === true,
  };
  if (Object.keys(filter).length) toolArguments.filter = filter;
  if (exactTerms.length) toolArguments.exact_terms = exactTerms;
  if (includeBm25) {
    toolArguments.bm25_query = keywords;
  } else {
    toolArguments.bm25 = false;
  }

  const intent =
    typeof params.intent === "string" && params.intent.trim()
      ? String(params.intent).trim().toUpperCase()
      : null;

  return {
    user_query: query,
    intent,
    query_manager: {
      query_original: query,
      intent,
      produtos: queries[dimMap.produto] || null,
      servicos: queries[dimMap.servico] || null,
      descricao: queries[dimMap.descricao] || null,
      publico: queries[dimMap.publico] || null,
      clientes: queries[dimMap.cliente] || null,
      bm25: includeBm25 ? keywords : null,
      exact_terms: exactTerms.length ? exactTerms : null,
      use_bm25: includeBm25,
      Modelo_Negocio: modelo,
      cidade_centro: cityName || null,
      uf: formatUfFilterValue(geoMeta?.ufs?.length ? geoMeta.ufs : ufs),
      ufs: geoMeta?.ufs?.length ? geoMeta.ufs : ufs,
      radius_km: geoMeta?.radius_km ?? radiusKm,
    },
    geo: geoMeta,
    mcp_tool_call: {
      name: "search_text",
      arguments: toolArguments,
    },
  };
}

function coerceWeightMap(raw, dimensionKeys, includeBm25) {
  const out = {};
  for (const key of dimensionKeys) {
    const v = Number(raw?.[key]);
    out[key] = Number.isFinite(v) && v >= 0 ? v : 0;
  }
  if (includeBm25) {
    const v = Number(raw?.bm25);
    out.bm25 = Number.isFinite(v) && v >= 0 ? v : 0;
  }
  const keys = Object.keys(out);
  const sum = keys.reduce((a, k) => a + out[k], 0);
  if (sum <= 0) {
    const eq = Number((1 / keys.length).toFixed(6));
    for (const k of keys) out[k] = eq;
  } else {
    for (const k of keys) out[k] = Number((out[k] / sum).toFixed(6));
  }
  const fixed = keys.reduce((a, k) => a + out[k], 0);
  out[keys[0]] = Number((out[keys[0]] + (1 - fixed)).toFixed(6));
  return out;
}

/** Executa tool call manual (sem LLM). */
export async function runManualToolCall({ toolArguments, executeSearchByText }) {
  const args = toolArguments && typeof toolArguments === "object" ? toolArguments : {};
  if (!args.query || typeof args.query !== "string" || !args.query.trim()) {
    const err = new Error("arguments.query é obrigatório");
    err.status = 400;
    throw err;
  }
  const searchStarted = Date.now();
  const search = await executeSearchByText(args, {
    debug: args.debug === true,
    rerank: args.rerank === true,
  });
  return {
    simulation: {
      client: "manual-mcp-tool-call",
      tools_available: ["get_config", "search_text"],
    },
    mcp_tool_call: { name: "search_text", arguments: args },
    search_duration_ms: Date.now() - searchStarted,
    search,
  };
}
