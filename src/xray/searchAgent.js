import OpenAI from "openai";

/**
 * Pré-proxy agent: simula o que um agente Microsoft (Copilot / MCP client)
 * fará ao chamar a tool search_text desta API.
 */

const MODEL = process.env.LLM_SEARCH_AGENT_MODEL || process.env.LLM_RERANK_MODEL || "gpt-4o-mini";

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

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function normalizeWeights(raw, dimensionKeys, includeBm25) {
  const keys = includeBm25 ? [...dimensionKeys, "bm25"] : [...dimensionKeys];
  const out = {};
  let sum = 0;
  for (const k of keys) {
    const v = clamp01(raw?.[k]);
    out[k] = v;
    sum += v;
  }
  if (sum <= 0) {
    const eq = 1 / keys.length;
    for (const k of keys) out[k] = eq;
    return out;
  }
  for (const k of keys) out[k] = out[k] / sum;
  let s = 0;
  for (const k of keys) {
    out[k] = Number(out[k].toFixed(6));
    s += out[k];
  }
  out[keys[0]] = Number((out[keys[0]] + (1 - s)).toFixed(6));
  return out;
}

function buildAgentPrompt(userQuery, config, options = {}) {
  const dims = config.dimension_keys || [];
  const keyword = config.payload_keys || [];
  const fullText = config.payload_keys_full_text || [];
  const hasBm25 = Boolean(config.bm25?.vector_name);
  const finalLimit = options.final_limit ?? 10;

  return `Você é um agente de busca B2B (prévia do Microsoft Copilot + MCP).
Sua única ação é montar os argumentos da tool MCP "search_text" desta API.

PEDIDO DO USUÁRIO:
"""${userQuery}"""

CONFIGURAÇÃO DA COLEÇÃO (get_config):
- Dimensões densas: ${JSON.stringify(dims)}
- Filtros keyword: ${JSON.stringify(keyword)}
- Filtros full-text: ${JSON.stringify(fullText)}
- BM25: ${hasBm25 ? `sim (${config.bm25.vector_name})` : "não"}
- Auth da API: ${JSON.stringify(config.auth || {})}

REGRAS:
1. Distribua weights nas dimensões densas${hasBm25 ? " + bm25" : ""}; soma = 1.0.
2. Em "queries", texto otimizado POR dimensão (não copie a frase cegamente).
3. "query" = reformulação curta para embedding geral.
4. "bm25_query" = termos lexicais${hasBm25 ? "" : " — omita ou bm25:false se BM25 off"}.
5. Extraia filter só se explícito (UF, cidade, modelo_negocio…). Não invente.
6. filter_not só para desambiguação clara.
7. final_limit padrão ${finalLimit}; limit_per_vector 50.
8. rerank=true só se ambígua ou pedir "melhores/mais relevantes".
9. debug=true se o usuário pedir para inspecionar o ranking.

Responda APENAS JSON válido:
{
  "reasoning": "2-4 frases do plano (como um Copilot explicaria)",
  "tool": "search_text",
  "arguments": {
    "query": "...",
    "queries": { ${dims.map((d) => `"${d}": "..."`).join(", ")} },
    "weights": { ${[...dims, ...(hasBm25 ? ["bm25"] : [])].map((d) => `"${d}": 0.0`).join(", ")} },
    "bm25_query": "...",
    "bm25": ${hasBm25 ? "true" : "false"},
    "filter": {},
    "filter_not": {},
    "limit_per_vector": 50,
    "final_limit": ${finalLimit},
    "rerank": false,
    "debug": false
  }
}`;
}

/**
 * Planeja args da tool MCP search_text (simula cliente Microsoft).
 */
export async function planSearchToolCall(userQuery, config, options = {}) {
  const query = typeof userQuery === "string" ? userQuery.trim() : "";
  if (!query) {
    const err = new Error("Campo 'query' é obrigatório");
    err.status = 400;
    throw err;
  }

  const dimensionKeys = config.dimension_keys || [];
  const hasBm25 = Boolean(config.bm25?.vector_name);
  const allowedFilterKeys = [
    ...(config.payload_keys || []),
    ...(config.payload_keys_full_text || []),
  ];

  const client = getClient();
  const prompt = buildAgentPrompt(query, config, options);
  const started = Date.now();

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Você é um cliente MCP (estilo Microsoft Copilot). Planeja parâmetros para search_text. Responda só JSON válido.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  const raw = response.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error("Agente retornou JSON inválido");
    err.status = 502;
    throw err;
  }

  const argsIn = parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {};
  const toolQuery =
    typeof argsIn.query === "string" && argsIn.query.trim() ? argsIn.query.trim() : query;

  const queries = {};
  if (argsIn.queries && typeof argsIn.queries === "object") {
    for (const dim of dimensionKeys) {
      const v = argsIn.queries[dim];
      if (typeof v === "string" && v.trim()) queries[dim] = v.trim();
    }
  }

  const useBm25 = hasBm25 && argsIn.bm25 !== false;
  const weights = normalizeWeights(argsIn.weights, dimensionKeys, useBm25);

  const filter = {};
  if (argsIn.filter && typeof argsIn.filter === "object" && !Array.isArray(argsIn.filter)) {
    for (const [k, v] of Object.entries(argsIn.filter)) {
      if (!allowedFilterKeys.includes(k)) continue;
      if (v == null || v === "") continue;
      filter[k] = v;
    }
  }

  const filter_not = {};
  if (argsIn.filter_not && typeof argsIn.filter_not === "object" && !Array.isArray(argsIn.filter_not)) {
    for (const [k, v] of Object.entries(argsIn.filter_not)) {
      if (!allowedFilterKeys.includes(k)) continue;
      if (v == null || v === "") continue;
      filter_not[k] = v;
    }
  }

  const toolArguments = {
    query: toolQuery,
    weights,
    limit_per_vector:
      Number.isInteger(Number(argsIn.limit_per_vector)) && Number(argsIn.limit_per_vector) >= 1
        ? Number(argsIn.limit_per_vector)
        : 50,
    final_limit:
      Number.isInteger(Number(argsIn.final_limit)) && Number(argsIn.final_limit) >= 1
        ? Number(argsIn.final_limit)
        : options.final_limit ?? 10,
    rerank: Boolean(argsIn.rerank),
    debug: Boolean(argsIn.debug) || options.debug === true,
  };

  if (Object.keys(queries).length) toolArguments.queries = queries;
  if (Object.keys(filter).length) toolArguments.filter = filter;
  if (Object.keys(filter_not).length) toolArguments.filter_not = filter_not;

  if (useBm25) {
    toolArguments.bm25_query =
      typeof argsIn.bm25_query === "string" && argsIn.bm25_query.trim()
        ? argsIn.bm25_query.trim()
        : toolQuery;
  } else {
    toolArguments.bm25 = false;
  }

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
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    user_query: query,
    simulation: {
      client: "microsoft-copilot-mcp-preview",
      tools_available: ["get_config", "search_text"],
      transport: "same-process (X-Ray) → produção usará Streamable HTTP /mcp",
    },
    mcp_tool_call: {
      name: "search_text",
      arguments: toolArguments,
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
}) {
  const plan = await planSearchToolCall(userQuery, config, { final_limit, debug });
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

/** Executa tool call manual (sem LLM) — para testar filtros/pesos. */
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
