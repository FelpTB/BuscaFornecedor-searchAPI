import OpenAI from "openai";
import { fetchCitiesNearby } from "../clients/citiesApi.js";

/**
 * Pré-proxy X-Ray = Query Manager B2B + bridge para tool MCP search_text.
 * Pesos fixos e regras BM25 discriminantes — alinhado ao prompt de produção.
 * Geo: API-busca-cidades → filter.cidade = lista de nomes.
 */

const MODEL = process.env.LLM_SEARCH_AGENT_MODEL || process.env.LLM_RERANK_MODEL || "gpt-4o-mini";

const MODELO_NEGOCIO_ALLOWED = [
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
A API executa 2 estratégias (léxica BM25 + semântica densa) e combina (RRF). Você alimenta vetores, pesos e BM25.

PEDIDO DO USUÁRIO:
"""${userQuery}"""

CONFIG DA API (dimensões reais → use nos textos; pesos serão aplicados pelo servidor):
- Dimensão produto: "${dimMap.produto}"
- Dimensão serviço: "${dimMap.servico}"
- Dimensão descrição: "${dimMap.descricao}"
- Dimensão público: "${dimMap.publico}"
- Dimensão clientes: "${dimMap.cliente}"
- BM25 na coleção: ${hasBm25 ? "SIM" : "NÃO (ainda gere bm25; o servidor pode desligar)"}
- final_limit sugerido: ${finalLimit}

TAREFA: CLASSIFICAÇÃO DE INTENÇÃO (única decisão de peso)

intent = PRODUTO | SERVICO | MISTO

O servidor aplica pesos FIXOS (soma 1.0):
- bm25=0.20, descricao=0.15, publico=0.03, clientes=0.02, núcleo produto+serviço=0.60
- PRODUTO → produtos=0.45, servicos=0.15
- SERVICO → servicos=0.45, produtos=0.15
- MISTO → produtos=0.30, servicos=0.30

Exemplos intent:
- "açaí" → PRODUTO
- "proteína bovina hidrolisada" → PRODUTO
- "soldagem de estruturas metálicas" → SERVICO
- "limpeza industrial" → SERVICO
- "instalação de ar condicionado" → MISTO

DIRETRIZES DE CONTEÚDO (ANTI-ERRO)

1) Ancoragem de Objeto (denso): em produtos e servicos, o objeto principal deve estar em cada termo.
   Ex.: "Higienização de Big Bags", "Manutenção de Silos".

2) BM25 — REGRA DISCRIMINANTE (CRÍTICA):
   bm25 deve conter APENAS termos que DIFERENCIAM este produto/serviço de vizinhos semânticos.
   PROIBIDO: substantivo genérico compartilhado com nichos vizinhos.
   Lógica:
   a) Identifique o termo que torna a busca específica
   b) Use só variações desse termo e termos técnicos exclusivos
   c) NÃO inclua o genérico compartilhado
   Exemplos:
   - "caroço de açaí" → bm25: "caroço caroços semente sementes biomassa resíduo" (SEM "açaí")
   - "proteína bovina hidrolisada" → bm25: "hidrolisada hidrolisado colágeno peptídeo" (SEM "bovina"/"carne")
   - "parafuso para embarcação" → bm25: "embarcação embarcações naval náutico marítimo inox" (SEM "parafuso")
   - "tinta epóxi para piso industrial" → bm25: "epóxi piso industrial revestimento resistência" (SEM "tinta")
   Queries GENÉRICAS (sem diferenciador): substantivos concretos singular/plural ok
   - "material de escritório" → bm25: "escritório papelaria papel caneta pasta"

3) Foco no produto acabado — evite só matéria-prima isolada ("banco de plástico" > só "polipropileno").

4) Sanitização — remova saudações, "orçamento", "teste".

5) Modelo_Negocio: EXATAMENTE um de ${JSON.stringify(MODELO_NEGOCIO_ALLOWED)}.

6) GEO — cidade (raio) OU UF estadual:
   a) CIDADE / RAIO (ex.: "em Campinas", "raio 50km", "região de Curitiba/PR"):
      - Preencha cidade_centro, uf (se souber), radius_km (default 50 se houver cidade sem raio).
      - O servidor chama API de cidades → filter.cidade = lista no raio.
   b) SÓ ESTADO / UF (ex.: "em SP", "no Paraná", "RJ e MG", "sudeste de SP e RJ"):
      - cidade_centro = null, radius_km = null.
      - uf = sigla(s) de 2 letras. Uma: "SP". Várias (OR): "SP,RJ,MG".
      - O servidor aplica filter.uf no Qdrant (sem expandir cidades).
   c) Sem indicação geográfica: cidade_centro/uf/radius_km = null.
   - NÃO invente lista de cidades vizinhas — só o centro + raio quando houver cidade.

7) PROIBIDO explicar fora do JSON. Retorne APENAS JSON.

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
  "bm25": "APENAS termos discriminantes (sem genérico compartilhado)",
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
 * @param {{ userQuery?: string, final_limit?: number, debug?: boolean, rerank?: boolean, cityNames?: string[]|null, geoMeta?: object|null, ufs?: string[]|null }} [options]
 */
export function mapQueryManagerToToolArgs(qm, config, options = {}) {
  const dimMap = resolveDimMap(config.dimension_keys);
  const hasBm25 = Boolean(config.bm25?.vector_name);
  const intent = normalizeIntent(qm.intent);
  const includeBm25 = hasBm25 && qm.bm25 !== false;
  const weights = buildFixedWeights(intent, dimMap, includeBm25);

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

  if (includeBm25) {
    toolArguments.bm25_query =
      typeof qm.bm25 === "string" && qm.bm25.trim() ? qm.bm25.trim() : query;
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
      bm25: qm.bm25 ?? null,
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
 * @param {{ final_limit?: number, debug?: boolean, rerank?: boolean, geo?: { city_name?: string, uf?: string|string[], ufs?: string[], radius_km?: number } }} [options]
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
      geoMeta = {
        city_name: geoReq.city_name,
        uf: geoReq.uf,
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
