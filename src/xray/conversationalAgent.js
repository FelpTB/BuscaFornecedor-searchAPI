/**
 * Agente conversacional X-Ray — multi-turn com tool calling.
 * Tools: search_suppliers (QM + cities + search_text), lookup_cities, get_search_config.
 */

import OpenAI from "openai";
import { fetchCitiesNearby } from "../clients/citiesApi.js";
import { planSearchToolCall } from "./searchAgent.js";
import {
  getOrCreateSession,
  resetSession,
  setSessionMessages,
  setSessionLastSearch,
  publicMessages,
} from "./chatSessions.js";

const MODEL =
  process.env.LLM_CHAT_AGENT_MODEL ||
  process.env.LLM_SEARCH_AGENT_MODEL ||
  process.env.LLM_RERANK_MODEL ||
  "gpt-4o-mini";

const MAX_TOOL_ROUNDS = Number(process.env.XRAY_CHAT_MAX_TOOL_ROUNDS) || 4;

let _client = null;
function getClient() {
  if (!_client) {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      const err = new Error("OPENAI_API_KEY não configurado; necessário para o chat X-Ray");
      err.status = 503;
      throw err;
    }
    _client = new OpenAI({ apiKey: key });
  }
  return _client;
}

export const CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_search_config",
      description:
        "Retorna a configuração pública da API de busca (dimensões, BM25, limites, auth mode). Use se precisar saber o que a busca aceita.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_cities",
      description:
        "Consulta cidades no raio de uma cidade centro (API-busca-cidades). Use para confirmar cobertura regional antes de buscar, ou quando o usuário perguntar quais cidades entram no filtro.",
      parameters: {
        type: "object",
        properties: {
          city_name: { type: "string", description: "Cidade centro (obrigatório)" },
          uf: { type: "string", description: "UF com 2 letras (opcional)" },
          radius_km: {
            type: "number",
            description: "Raio em km (1–500). Default 50.",
          },
        },
        required: ["city_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_suppliers",
      description:
        "Executa a busca de fornecedores via Query Manager (intent, pesos fixos, BM25 discriminante) + filtro regional opcional. Use quando o briefing estiver claro o bastante (o que buscar + preferências). NÃO invente resultados — só esta tool retorna fornecedores reais.",
      parameters: {
        type: "object",
        properties: {
          briefing: {
            type: "string",
            description:
              "Pedido consolidado em linguagem natural (produto/serviço, atributos, público, modelo de negócio se houver).",
          },
          city_name: {
            type: "string",
            description: "Cidade centro para filtro regional (opcional)",
          },
          uf: { type: "string", description: "UF 2 letras (opcional)" },
          radius_km: {
            type: "number",
            description: "Raio km se houver cidade (default 50)",
          },
          final_limit: {
            type: "integer",
            description: "Quantidade de resultados (1–100). Default da sessão/UI.",
          },
          debug: { type: "boolean" },
          rerank: { type: "boolean" },
        },
        required: ["briefing"],
        additionalProperties: false,
      },
    },
  },
];

function buildSystemPrompt(config) {
  const dims =
    (config?.dimension_keys || []).join(", ") ||
    "produto, servico, descricao, publico, cliente";
  return `Você é o assistente conversacional do BuscaFornecedor (X-Ray / pré-proxy Microsoft MCP).

Papel: consultor B2B de sourcing. Conversa em português do Brasil, tom claro e profissional.

Comportamento:
1. Guie o usuário por linguagem natural — não é um formulário. Pode perguntar o que falta (o quê buscar, região, modelo Fabricante/Distribuidor/etc., quantidade de resultados).
2. NÃO invente fornecedores, CNPJs, notas ou rankings. Só cite empresas que vieram de search_suppliers.
3. Quando o briefing estiver suficiente, chame search_suppliers. Se faltar o essencial (o que buscar), peça clarificação em vez de buscar.
4. Aceite refinamentos: "só Fabricante", "aumenta o raio", "troca para Curitiba", "quero 20 resultados" → nova busca com o contexto acumulado.
5. Após uma busca, resuma em linguagem natural (top nomes, cidade/UF, modelo) e sugira próximos ajustes.
6. Use lookup_cities se precisar explicar cobertura do raio; get_search_config só se for útil.
7. Respostas curtas a médias; evite jargão interno (não mencione "Query Manager", "RRF", "tool call") na conversa com o usuário — a UI mostra o X-Ray técnico à parte.

Config da API: dimensões [${dims}]; BM25 ${config?.bm25?.vector_name ? "ativo" : "inativo"}; final_limit máx ${config?.limits?.final_limit_max ?? 100}.`;
}

/** Resume resultados para o LLM (não o payload inteiro). */
function summarizeSearchForLlm(plan, search) {
  const results = Array.isArray(search?.results) ? search.results : [];
  return {
    ok: true,
    intent: plan?.intent ?? null,
    search_id: search?.search_id ?? null,
    latency_ms: search?.latency_ms ?? null,
    geo: plan?.geo
      ? {
          city_name: plan.geo.city_name,
          uf: plan.geo.uf,
          radius_km: plan.geo.radius_km,
          cities_in_filter: plan.geo.cities_in_filter,
          truncated: plan.geo.truncated,
          error: plan.geo.error || null,
          sample: plan.geo.city_names_sample || null,
        }
      : null,
    result_count: results.length,
    top: results.slice(0, 12).map((r) => {
      const p = r.payload || {};
      return {
        posicao: r.posicao,
        nome_empresa: p.nome_empresa || null,
        cnpj: p.cnpj || null,
        cidade: p.cidade || null,
        uf: p.uf || null,
        modelo_negocio: p.modelo_negocio || null,
        score_final: r.score_final ?? null,
        descricao: typeof p.descricao === "string" ? p.descricao.slice(0, 160) : null,
      };
    }),
  };
}

function summarizeCitiesForLlm(nearby) {
  return {
    ok: true,
    total_found: nearby.total_found,
    cities_in_filter: nearby.city_names?.length ?? 0,
    truncated: nearby.truncated,
    radius_km: nearby.radius_km,
    center_city: nearby.center_city
      ? { name: nearby.center_city.name, uf: nearby.center_city.uf }
      : null,
    city_names_sample: (nearby.city_names || []).slice(0, 25),
  };
}

/**
 * @param {string} name
 * @param {object} args
 * @param {object} ctx
 */
async function executeTool(name, args, ctx) {
  const { config, executeSearchByText, defaults, onSearch, onCities } = ctx;

  if (name === "get_search_config") {
    return {
      dimension_keys: config.dimension_keys,
      bm25: config.bm25,
      limits: config.limits,
      auth: config.auth,
      mcp: config.mcp,
    };
  }

  if (name === "lookup_cities") {
    const city_name = typeof args.city_name === "string" ? args.city_name.trim() : "";
    if (!city_name) return { ok: false, error: "city_name obrigatório" };
    try {
      const nearby = await fetchCitiesNearby({
        city_name,
        uf: args.uf,
        radius_km: args.radius_km ?? 50,
      });
      const summary = summarizeCitiesForLlm(nearby);
      onCities?.(nearby, summary);
      return summary;
    } catch (e) {
      return { ok: false, error: e.message || String(e), status: e.status };
    }
  }

  if (name === "search_suppliers") {
    const briefing = typeof args.briefing === "string" ? args.briefing.trim() : "";
    if (!briefing) return { ok: false, error: "briefing obrigatório" };

    const geo = {};
    if (typeof args.city_name === "string" && args.city_name.trim()) {
      geo.city_name = args.city_name.trim();
      if (typeof args.uf === "string" && args.uf.trim()) geo.uf = args.uf.trim();
      geo.radius_km =
        args.radius_km != null && args.radius_km !== ""
          ? Number(args.radius_km)
          : 50;
    }

    const final_limit =
      Number.isInteger(Number(args.final_limit)) && Number(args.final_limit) >= 1
        ? Number(args.final_limit)
        : defaults.final_limit;

    try {
      const plan = await planSearchToolCall(briefing, config, {
        final_limit,
        debug: args.debug === true || defaults.debug === true,
        rerank: args.rerank === true || defaults.rerank === true,
        geo: Object.keys(geo).length ? geo : undefined,
      });
      const searchStarted = Date.now();
      const search = await executeSearchByText(plan.mcp_tool_call.arguments, {
        debug: plan.mcp_tool_call.arguments.debug === true,
        rerank: plan.mcp_tool_call.arguments.rerank === true,
      });
      const search_duration_ms = Date.now() - searchStarted;
      const full = { ...plan, search_duration_ms, search };
      onSearch?.(full);
      return summarizeSearchForLlm(plan, search);
    } catch (e) {
      return { ok: false, error: e.message || String(e), status: e.status };
    }
  }

  return { ok: false, error: `Tool desconhecida: ${name}` };
}

/**
 * Um turno de conversa.
 */
export async function runChatTurn({
  session_id,
  message,
  config,
  executeSearchByText,
  final_limit = 10,
  debug = false,
  rerank = false,
}) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) {
    const err = new Error("Campo 'message' é obrigatório");
    err.status = 400;
    throw err;
  }

  const session = getOrCreateSession(session_id);
  const client = getClient();
  const started = Date.now();

  const actions = [];
  let lastPlan = null;
  let lastSearchBundle = null;
  let lastCities = null;

  const openaiMessages = [
    { role: "system", content: buildSystemPrompt(config) },
    ...session.messages.filter((m) => m.role !== "system"),
    { role: "user", content: text },
  ];

  const toolCtx = {
    config,
    executeSearchByText,
    defaults: {
      final_limit:
        Number.isInteger(Number(final_limit)) && Number(final_limit) >= 1
          ? Number(final_limit)
          : 10,
      debug: debug === true,
      rerank: rerank === true,
    },
    onSearch: (bundle) => {
      lastSearchBundle = bundle;
      lastPlan = bundle;
      actions.push({
        tool: "search_suppliers",
        intent: bundle.intent,
        result_count: bundle.search?.results?.length ?? 0,
        search_id: bundle.search?.search_id,
        geo: bundle.geo
          ? {
              city: bundle.geo.city_name,
              cities: bundle.geo.cities_in_filter,
              radius_km: bundle.geo.radius_km,
            }
          : null,
      });
    },
    onCities: (nearby) => {
      lastCities = nearby;
      actions.push({
        tool: "lookup_cities",
        cities: nearby.city_names?.length ?? 0,
        radius_km: nearby.radius_km,
      });
    },
  };

  let reply = "";
  let tokens_used = null;
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds += 1;
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: openaiMessages,
      tools: CHAT_TOOLS,
      tool_choice: "auto",
      temperature: 0.35,
    });

    if (response.usage) {
      tokens_used = {
        prompt: (tokens_used?.prompt || 0) + (response.usage.prompt_tokens || 0),
        completion:
          (tokens_used?.completion || 0) + (response.usage.completion_tokens || 0),
        total: (tokens_used?.total || 0) + (response.usage.total_tokens || 0),
      };
    }

    const choice = response.choices?.[0]?.message;
    if (!choice) break;

    const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];

    if (toolCalls.length === 0) {
      reply = typeof choice.content === "string" ? choice.content.trim() : "";
      openaiMessages.push({
        role: "assistant",
        content: reply || "(sem resposta)",
      });
      break;
    }

    openaiMessages.push({
      role: "assistant",
      content: choice.content || null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      const name = tc.function?.name || "";
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        args = {};
      }
      const result = await executeTool(name, args, toolCtx);
      openaiMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
      if (name === "get_search_config") {
        actions.push({ tool: "get_search_config" });
      }
    }
  }

  if (!reply) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        ...openaiMessages,
        {
          role: "user",
          content:
            "Com base no histórico e nas tools, responda agora ao usuário em português, sem chamar tools.",
        },
      ],
      temperature: 0.35,
    });
    if (response.usage) {
      tokens_used = {
        prompt: (tokens_used?.prompt || 0) + (response.usage.prompt_tokens || 0),
        completion:
          (tokens_used?.completion || 0) + (response.usage.completion_tokens || 0),
        total: (tokens_used?.total || 0) + (response.usage.total_tokens || 0),
      };
    }
    reply =
      response.choices?.[0]?.message?.content?.trim() ||
      "Pronto — posso ajustar a busca se quiser.";
    openaiMessages.push({ role: "assistant", content: reply });
  }

  const toStore = openaiMessages.filter((m) => m.role !== "system");
  setSessionMessages(session, toStore);

  if (lastSearchBundle) {
    setSessionLastSearch(session, lastSearchBundle, lastSearchBundle.search);
  }

  return {
    session_id: session.id,
    reply,
    messages: publicMessages(session),
    actions,
    model: MODEL,
    duration_ms: Date.now() - started,
    tokens_used,
    intent: lastPlan?.intent ?? null,
    query_manager: lastPlan?.query_manager ?? null,
    geo: lastPlan?.geo
      ?? (lastCities
        ? {
            city_name: lastCities.center_city?.name,
            cities_in_filter: lastCities.city_names?.length,
            city_names_sample: lastCities.city_names?.slice(0, 15),
          }
        : null),
    mcp_tool_call: lastPlan?.mcp_tool_call ?? null,
    search: lastSearchBundle?.search ?? null,
    search_duration_ms: lastSearchBundle?.search_duration_ms ?? null,
    reasoning: lastPlan?.reasoning ?? null,
    simulation: {
      client: "conversational-agent → microsoft-copilot-mcp-preview",
      role: "Chat B2B + Query Manager + Cities API",
      tools_available: CHAT_TOOLS.map((t) => t.function.name),
      transport: "same-process (X-Ray) → produção usará Streamable HTTP /mcp",
      tool_rounds: rounds,
    },
  };
}

export function resetChatSession(session_id) {
  const session = resetSession(session_id);
  return {
    session_id: session.id,
    messages: [],
  };
}
