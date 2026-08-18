/**
 * Agente conversacional X-Ray — multi-turn com tool calling.
 * Tools: search_suppliers, expand_search_fallback, lookup_cities, get_search_config, auth.
 */

import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { fetchCitiesNearby } from "../clients/citiesApi.js";
import { planSearchToolCall, planSearchFromParams, normalizeUfList, formatUfFilterValue } from "./searchAgent.js";
import { resolveExactTerms } from "../search/bm25Query.js";
import { runFallbackCascade } from "../search/fallbackSearch.js";
import {
  mapResultsForDisplay,
  formatResultsMarkdown,
  RESULT_DISPLAY_PROMPT,
} from "../search/resultDisplay.js";
import {
  getOrCreateSession,
  resetSession,
  setSessionMessages,
  setSessionLastSearch,
  publicMessages,
} from "./chatSessions.js";
import { registerBuyer, loginBuyer, getProfile } from "../auth/registerBuyer.js";
import { publicAuthView } from "../auth/resolveAuth.js";
import { requireComprador } from "../config/env.js";
import { isSupabaseConfigured } from "../db/supabaseAdmin.js";

const MODEL =
  process.env.LLM_CHAT_AGENT_MODEL ||
  process.env.LLM_SEARCH_AGENT_MODEL ||
  process.env.LLM_RERANK_MODEL ||
  "gpt-4o-mini";

const MAX_TOOL_ROUNDS = Number(process.env.XRAY_CHAT_MAX_TOOL_ROUNDS) || 4;

function llmAuthToolsEnabled() {
  const raw = (process.env.XRAY_LLM_AUTH_TOOLS ?? "1").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

const AUTH_TOOL_NAMES = new Set(["register_buyer", "login_buyer"]);

/** Tools expostas ao modelo (respeita XRAY_LLM_AUTH_TOOLS). */
export function getChatTools() {
  if (llmAuthToolsEnabled()) return CHAT_TOOLS;
  return CHAT_TOOLS.filter((t) => !AUTH_TOOL_NAMES.has(t.function?.name));
}

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
      name: "get_my_profile",
      description:
        "Retorna o perfil do comprador autenticado (cotas, keys prefix). Use para saber se o usuário já tem conta.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "register_buyer",
      description:
        "Cria conta NOVA de comprador no Supabase + emite API key (mostrada 1x). Se o e-mail já existir, use login_buyer. Peça nome, email, senha (recomendado) e telefone/empresa opcionais.",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string" },
          nome: { type: "string" },
          password: { type: "string", description: "Mín. 8 caracteres — permite login futuro" },
          telefone: { type: "string" },
          empresa_nome: { type: "string" },
        },
        required: ["email", "nome"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "login_buyer",
      description:
        "Login de conta JÁ EXISTENTE (email + senha do Supabase Auth) e emite nova API key. Use quando o usuário já tem conta no produto/front ou cadastrou antes. Não cria usuário novo.",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string" },
          password: { type: "string" },
        },
        required: ["email", "password"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_cities",
      description:
        "Consulta cidades no raio de uma cidade centro (API-busca-cidades). Use para confirmar cobertura regional antes de buscar.",
      parameters: {
        type: "object",
        properties: {
          city_name: { type: "string" },
          uf: { type: "string" },
          radius_km: { type: "number" },
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
        "Executa a busca de fornecedores via Query Manager. Geo: use city_name(+uf/radius_km) para raio municipal; use só uf (sem city_name) para filtro estadual — 'SP' ou 'SP,RJ,MG' (OR). Requer perfil comprador quando REQUIRE_COMPRADOR=1. NÃO invente resultados.",
      parameters: {
        type: "object",
        properties: {
          briefing: { type: "string" },
          city_name: {
            type: "string",
            description: "Cidade centro para raio (API cidades). Omita em busca só por UF.",
          },
          uf: {
            type: "string",
            description:
              "UF(s): 'SP' ou 'SP,RJ,MG' (OR no Qdrant). Sem city_name = filtro estadual. Com city_name = desambigua a API de cidades.",
          },
          radius_km: { type: "number" },
          final_limit: { type: "integer" },
          debug: { type: "boolean" },
          rerank: { type: "boolean" },
          exact_terms: {
            type: "array",
            items: { type: "string" },
            description:
              "Termos exatos de marca/modelo/SKU (ex.: iPhone 16 Pro). Extraia do briefing mesmo sem aspas. Vão obrigatoriamente para BM25/sparse.",
          },
        },
        required: ["briefing"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "expand_search_fallback",
      description:
        "Amplia a ÚLTIMA busca mudando o filtro geográfico (remove cidade/raio; UF ou nacional) e exclui CNPJs já listados. OBRIGATÓRIO quando o usuário pedir busca estadual/nacional/mais geral — NÃO chame search_suppliers de novo com a mesma cidade. Use scope=nacional se pedir nacional; scope=uf se pedir estadual.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["auto", "uf", "nacional"],
            description:
              "auto = UF depois nacional; uf = só estadual; nacional = sem filtro de cidade/UF",
          },
          final_limit: {
            type: "integer",
            description: "Opcional — override do limite; default = da última busca",
          },
          mode: {
            type: "string",
            enum: ["auto", "fill", "replace"],
            description:
              "replace = só empresas novas (use quando a busca regional veio cheia mas irrelevante, ou usuário pediu nacional sem repetir). fill = completa cota mantendo anteriores. auto escolhe replace se já havia final_limit resultados.",
          },
        },
        additionalProperties: false,
      },
    },
  },
];

function buildSystemPrompt(config, auth) {
  const dims =
    (config?.dimension_keys || []).join(", ") ||
    "produto, servico, descricao, publico, cliente";
  const authLine = auth?.authenticated
    ? `Usuário autenticado (provider=${auth.provider}, userId=${auth.userId || "—"}${auth.comprador ? `, cotas ${auth.comprador.buscasRealizadas}/${auth.comprador.limiteBuscas}` : ", sem perfil comprador"}).`
    : "Usuário NÃO autenticado. Se REQUIRE_COMPRADOR estiver ativo ou ele quiser histórico: oriente cadastro (register_buyer) OU login de conta existente (login_buyer com email+senha). Após sucesso a sessão fica autenticada automaticamente no X-Ray.";

  return `Você é o assistente conversacional do BuscaFornecedor (X-Ray / pré-proxy Microsoft MCP).

Papel: consultor B2B de sourcing. Conversa em português do Brasil.

Identidade:
${authLine}
Supabase configurado: ${isSupabaseConfigured() ? "sim" : "não"}. REQUIRE_COMPRADOR=${requireComprador() ? "sim" : "não"}.

Comportamento:
1. Guie por linguagem natural. Pode clarificar produto, região, modelo de negócio.
2. Conta nova: peça nome + email + senha e chame register_buyer. Conta existente: peça email + senha e chame login_buyer. No X-Ray a chave é aplicada automaticamente (não peça ao usuário para copiar a key do chat). Diga que a sessão já está autenticada e continue (pode buscar no mesmo turno).
3. Se register_buyer retornar EMAIL_EXISTS, use login_buyer.
4. NÃO invente fornecedores. Só cite resultados de search_suppliers ou expand_search_fallback.
5. Busque quando o briefing estiver claro. Refinamentos geram nova busca. Após register/login bem-sucedido neste turno, a auth já vale para search_suppliers.
6. GEO na tool search_suppliers:
   - Pediu cidade/raio → city_name (+ uf se souber) + radius_km.
   - Pediu estado(s)/UF sem cidade → passe uf="SP" ou uf="SP,RJ,MG" e NÃO passe city_name (filtro Qdrant por UF).
7. TERMO EXATO / MODELO / MARCA: aspas, "especificamente", "modelo X", "marca Y", SKU,
   geração ou código (Xiaomi Redmi Note 10, iPhone 16 Pro, Samsung S10) → passe exact_terms
   com o modelo/marca completo. O servidor aplica isso na busca; NÃO desligue nem peça
   "busca sem termos exatos" se der erro. Se search_suppliers retornar ok:false, mostre
   a mensagem de erro e ofereça tentar de novo — sem mudar a estratégia de termos.
   Buscas amplas sem marca/modelo (ex. "embalagens em SP") seguem sem exact_terms.
8. Após busca, resuma tops. Histórico/aparições gravam async no Supabase quando autenticado.
9. Evite jargão interno (Query Manager, RRF, Fallback Vector) na conversa — fale em "busca mais geral / estadual / nacional".

Fallback (busca mais geral) — regra obrigatória:
- Se search_suppliers retornar result_count < requested_limit (suggest_broader_search=true), AO FINAL PERGUNTE se deseja busca mais geral. NÃO chame expand_search_fallback nesse mesmo turno.
- Se os resultados vierem cheios mas IRRELEVANTES ao produto pedido, também PERGUNTE se quer expandir (estadual/nacional).
- Se o usuário reclamar OU confirmar expansão OU pedir "busca nacional/estadual/mais geral": chame expand_search_fallback (NUNCA search_suppliers de novo com a mesma cidade).
  - Pediu nacional → scope="nacional", mode="replace"
  - Pediu estadual/UF → scope="uf", mode="replace"
  - Só disse "sim" à pergunta → scope="auto", mode="auto"
- Depois, diga claramente o escopo usado (estadual/nacional), quantas empresas NOVAS entrou e se removeu o filtro de cidade.

${RESULT_DISPLAY_PROMPT}

Config: dims [${dims}]; BM25 ${config?.bm25?.vector_name ? "on" : "off"}.`;
}

/** Resume resultados para o LLM (não o payload inteiro). */
function summarizeSearchForLlm(plan, search) {
  const results = Array.isArray(search?.results) ? search.results : [];
  const requested =
    Number(plan?.mcp_tool_call?.arguments?.final_limit) ||
    Number(search?.final_limit) ||
    results.length;
  const shortfall = Math.max(0, requested - results.length);
  return {
    ok: true,
    intent: plan?.intent ?? null,
    search_id: search?.search_id ?? null,
    latency_ms: search?.latency_ms ?? null,
    requested_limit: requested,
    result_count: results.length,
    shortfall,
    suggest_broader_search: shortfall > 0,
    geo: plan?.geo
      ? {
          city_name: plan.geo.city_name,
          uf: plan.geo.uf,
          ufs: plan.geo.ufs || null,
          scope: plan.geo.scope || null,
          radius_km: plan.geo.radius_km,
          cities_in_filter: plan.geo.cities_in_filter,
          truncated: plan.geo.truncated,
          error: plan.geo.error || null,
          sample: plan.geo.city_names_sample || null,
        }
      : null,
    top: mapResultsForDisplay(results),
    display_format:
      "nome · local · modelo · descricao · site_md · perfil_md (links markdown)",
    hint:
      shortfall > 0
        ? "Faltaram resultados vs o pedido. PERGUNTE se o usuário quer busca mais geral; só chame expand_search_fallback após confirmação."
        : null,
  };
}

function summarizeFallbackForLlm(cascade, plan) {
  return {
    ok: true,
    fallback: true,
    expanded: cascade.expanded,
    filled: cascade.filled,
    mode: cascade.mode,
    scope: cascade.scope,
    reason: cascade.reason || null,
    hint: cascade.hint || null,
    requested_limit: cascade.requested_limit,
    result_count_before: cascade.result_count_before,
    result_count: cascade.result_count,
    new_count: cascade.new_count,
    shortfall: cascade.shortfall,
    last_filter: cascade.last_filter,
    geo_relaxed: true,
    stages: (cascade.stages || []).map((s) => ({
      name: s.name,
      ok: s.ok,
      added: s.added ?? 0,
      fetched: s.fetched ?? 0,
      filter: s.filter ?? null,
      filter_removed_geo: s.filter_removed_geo === true,
      error: s.error || null,
    })),
    intent: plan?.intent ?? null,
    top: mapResultsForDisplay(cascade.results),
    display_format:
      "nome · local · modelo · descricao · site_md · perfil_md (links markdown)",
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

/** AuthContext a partir do retorno de register/login — vale para tools no mesmo turno. */
function authFromBuyerResult(out) {
  const c = out?.comprador || {};
  return {
    authenticated: true,
    apiKeyId: out?.api_key?.id || null,
    userId: out?.user_id || null,
    orgId: null,
    keyPrefix: out?.api_key?.key_prefix || null,
    provider: "api_key",
    roles: ["comprador"],
    scopes: ["search"],
    comprador: {
      nome: c.nome ?? null,
      tierBusca: c.tier_busca || "normal",
      limiteBuscas: Number(c.limite_buscas ?? 50),
      buscasRealizadas: Number(c.buscas_realizadas ?? 0),
    },
  };
}

/**
 * @param {string} name
 * @param {object} args
 * @param {object} ctx
 */
async function executeTool(name, args, ctx) {
  const {
    config,
    executeSearchByText,
    defaults,
    onSearch,
    onCities,
    auth,
    assertCanSearch,
    session,
  } = ctx;

  if (name === "get_search_config") {
    return {
      dimension_keys: config.dimension_keys,
      bm25: config.bm25,
      limits: config.limits,
      auth: config.auth,
      supabase: config.supabase,
      mcp: config.mcp,
    };
  }

  if (name === "get_my_profile") {
    if (!auth?.userId) {
      return {
        ok: false,
        authenticated: false,
        hint: "Cole a API key no painel X-Ray, faça login_buyer (conta existente) ou register_buyer (nova)",
      };
    }
    try {
      const profile = await getProfile(auth.userId);
      return { ok: true, ...profile };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  if (name === "register_buyer") {
    if (!llmAuthToolsEnabled()) {
      return { ok: false, error: "register_buyer desabilitado (XRAY_LLM_AUTH_TOOLS=0)" };
    }
    try {
      const out = await registerBuyer({
        email: args.email,
        nome: args.nome,
        password: args.password,
        telefone: args.telefone,
        empresa_nome: args.empresa_nome,
        fonte: "X-Ray",
        key_name: "xray-chat",
      });
      ctx.auth = authFromBuyerResult(out);
      if (ctx.session && ctx.auth?.userId) {
        ctx.session.userId = ctx.auth.userId;
      }
      if (typeof out.api_key?.key === "string" && out.api_key.key) {
        ctx.issuedApiKey = out.api_key.key;
      }
      return {
        ok: true,
        user_id: out.user_id,
        email: out.email,
        comprador: out.comprador,
        api_key: {
          id: out.api_key?.id ?? null,
          key_prefix: out.api_key?.key_prefix ?? null,
          name: out.api_key?.name ?? null,
        },
        auth_upgraded: true,
        next_step:
          "Sessão autenticada neste turno. A API key plaintext foi aplicada automaticamente no X-Ray (issued_api_key na resposta HTTP). Confirme ao usuário que está autenticado e pode buscar — não peça para copiar a key do chat.",
      };
    } catch (e) {
      return {
        ok: false,
        error: e.message || String(e),
        status: e.status,
        code: e.details?.code,
        hint: e.details?.code === "EMAIL_EXISTS" ? "Use login_buyer com email e senha" : undefined,
      };
    }
  }

  if (name === "login_buyer") {
    if (!llmAuthToolsEnabled()) {
      return { ok: false, error: "login_buyer desabilitado (XRAY_LLM_AUTH_TOOLS=0)" };
    }
    try {
      const out = await loginBuyer({
        email: args.email,
        password: args.password,
        fonte: "X-Ray",
        key_name: "xray-chat-login",
      });
      ctx.auth = authFromBuyerResult(out);
      if (ctx.session && ctx.auth?.userId) {
        ctx.session.userId = ctx.auth.userId;
      }
      if (typeof out.api_key?.key === "string" && out.api_key.key) {
        ctx.issuedApiKey = out.api_key.key;
      }
      return {
        ok: true,
        user_id: out.user_id,
        email: out.email,
        comprador: out.comprador,
        api_key: {
          id: out.api_key?.id ?? null,
          key_prefix: out.api_key?.key_prefix ?? null,
          name: out.api_key?.name ?? null,
        },
        auth_upgraded: true,
        next_step:
          "Sessão autenticada neste turno. A API key plaintext foi aplicada automaticamente no X-Ray (issued_api_key na resposta HTTP). Confirme ao usuário que está autenticado e pode buscar — não peça para copiar a key do chat.",
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e), status: e.status };
    }
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

    if (typeof assertCanSearch === "function") {
      try {
        await assertCanSearch(auth || {});
      } catch (e) {
        return {
          ok: false,
          error: e.message || String(e),
          status: e.status,
          needs_register: e.status === 401 || e.status === 403,
        };
      }
    }

    const geo = {};
    if (typeof args.city_name === "string" && args.city_name.trim()) {
      geo.city_name = args.city_name.trim();
      geo.radius_km =
        args.radius_km != null && args.radius_km !== ""
          ? Number(args.radius_km)
          : 50;
    }

    // UF: string "SP" | "SP,RJ" | array — funciona COM ou SEM cidade
    const ufs = normalizeUfList(args.uf);
    if (ufs.length) {
      geo.uf = formatUfFilterValue(ufs);
      if (ufs.length > 1) geo.ufs = ufs;
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
        exact_terms: resolveExactTerms({
          exact_terms: Array.isArray(args.exact_terms)
            ? args.exact_terms
            : typeof args.exact_terms === "string"
              ? args.exact_terms
              : undefined,
          userQuery: briefing,
        }),
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

  if (name === "expand_search_fallback") {
    if (typeof assertCanSearch === "function") {
      try {
        await assertCanSearch(auth || {});
      } catch (e) {
        return {
          ok: false,
          error: e.message || String(e),
          status: e.status,
          needs_register: e.status === 401 || e.status === 403,
        };
      }
    }

    const plan = session?.lastPlan || null;
    const prevSearch = session?.lastSearch || null;
    const baseArgs = plan?.mcp_tool_call?.arguments;
    if (!baseArgs || !prevSearch) {
      return {
        ok: false,
        error: "Nenhuma busca anterior nesta sessão. Execute search_suppliers primeiro.",
      };
    }

    const final_limit =
      Number.isInteger(Number(args.final_limit)) && Number(args.final_limit) >= 1
        ? Number(args.final_limit)
        : Number(baseArgs.final_limit) || defaults.final_limit;

    const scopeRaw = typeof args.scope === "string" ? args.scope.trim().toLowerCase() : "auto";
    const scope =
      scopeRaw === "uf" || scopeRaw === "nacional" || scopeRaw === "auto" ? scopeRaw : "auto";
    const modeRaw = typeof args.mode === "string" ? args.mode.trim().toLowerCase() : "auto";
    const mode =
      modeRaw === "fill" || modeRaw === "replace" || modeRaw === "auto" ? modeRaw : "auto";

    try {
      const existingResults = Array.isArray(prevSearch.results) ? prevSearch.results : [];
      const cascade = await runFallbackCascade({
        baseArgs,
        plan,
        existingResults,
        finalLimit: final_limit,
        scope,
        mode,
        executeSearchByText,
      });

      const search = {
        ...(prevSearch || {}),
        results: cascade.results,
        result_count: cascade.result_count,
        fallback: true,
        fallback_meta: {
          stages: cascade.stages,
          result_count_before: cascade.result_count_before,
          new_count: cascade.new_count,
          filled: cascade.filled,
          expanded: cascade.expanded,
          mode: cascade.mode,
          scope: cascade.scope,
          last_filter: cascade.last_filter,
        },
        // Novo search_id: evita already_persisted e permite gravar consulta/aparições da expansão
        search_id: randomUUID(),
        parent_search_id: prevSearch?.search_id || null,
      };

      const full = {
        ...plan,
        intent: plan?.intent ?? null,
        // geo da busca ampliada: sem cidade
        geo:
          cascade.last_filter?.uf
            ? { uf: cascade.last_filter.uf, city_name: null, scope: cascade.scope }
            : { city_name: null, uf: null, scope: cascade.scope || "nacional" },
        search_duration_ms: (cascade.stages || []).reduce(
          (a, s) => a + (s.duration_ms || 0),
          0,
        ),
        search,
        fallback: cascade,
        mcp_tool_call: {
          name: "search_text",
          arguments: {
            ...baseArgs,
            filter: cascade.last_filter || undefined,
            final_limit,
            fallback: true,
            scope: cascade.scope,
            mode: cascade.mode,
            parent_search_id: prevSearch?.search_id || null,
          },
        },
      };
      if (!full.mcp_tool_call.arguments.filter) {
        delete full.mcp_tool_call.arguments.filter;
      }
      onSearch?.(full);
      return summarizeFallbackForLlm(cascade, plan);
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
  auth = null,
  assertCanSearch = null,
  onSearchCompleted = null,
  search_params = null,
}) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) {
    const err = new Error("Campo 'message' é obrigatório");
    err.status = 400;
    throw err;
  }

  if (search_params && typeof search_params === "object") {
    return runParamsRerunTurn({
      session_id,
      message: text,
      search_params,
      config,
      executeSearchByText,
      final_limit,
      debug,
      rerank,
      auth,
      assertCanSearch,
      onSearchCompleted,
    });
  }

  const session = getOrCreateSession(session_id, {
    userId: auth?.userId || null,
  });
  const client = getClient();
  const started = Date.now();

  const actions = [];
  let lastPlan = null;
  let lastSearchBundle = null;
  let lastCities = null;

  const openaiMessages = [
    { role: "system", content: buildSystemPrompt(config, auth) },
    ...session.messages.filter((m) => m.role !== "system"),
    { role: "user", content: text },
  ];

  const toolCtx = {
    config,
    executeSearchByText,
    auth,
    assertCanSearch,
    session,
    issuedApiKey: null,
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
      const toolName = bundle?.fallback ? "expand_search_fallback" : "search_suppliers";
      actions.push({
        tool: toolName,
        intent: bundle.intent,
        result_count: bundle.search?.results?.length ?? 0,
        search_id: bundle.search?.search_id,
        fallback: Boolean(bundle.fallback),
        stages: bundle.fallback?.stages?.map((s) => s.name) || null,
        geo: bundle.geo
          ? {
              city: bundle.geo.city_name,
              cities: bundle.geo.cities_in_filter,
              radius_km: bundle.geo.radius_km,
              uf: bundle.geo.uf,
              ufs: bundle.geo.ufs || null,
              scope: bundle.geo.scope || null,
            }
          : null,
      });
      // Persiste na sessão imediatamente para o fallback no mesmo turno (se houver)
      setSessionLastSearch(session, bundle, bundle.search);
      onSearchCompleted?.(bundle, toolCtx.auth, session.id);
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
      tools: getChatTools(),
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
      if (name === "register_buyer") {
        actions.push({
          tool: "register_buyer",
          ok: result?.ok === true,
          auth_upgraded: result?.auth_upgraded === true,
        });
      }
      if (name === "login_buyer") {
        actions.push({
          tool: "login_buyer",
          ok: result?.ok === true,
          auth_upgraded: result?.auth_upgraded === true,
        });
      }
      if (name === "get_my_profile") {
        actions.push({ tool: "get_my_profile" });
      }
      // expand_search_fallback / search_suppliers já registram via onSearch
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
    /** plaintext 1x — UI X-Ray aplica automaticamente; não logar */
    issued_api_key: toolCtx.issuedApiKey || null,
    auth: publicAuthView(toolCtx.auth),
    simulation: {
      client: "conversational-agent → microsoft-copilot-mcp-preview",
      role: "Chat B2B + Query Manager + Cities API + Fallback",
      tools_available: getChatTools().map((t) => t.function.name),
      transport: "same-process (X-Ray) → produção usará Streamable HTTP /mcp",
      tool_rounds: rounds,
    },
    fallback: lastSearchBundle?.fallback ?? null,
  };
}

/**
 * Refaz a busca com parâmetros explícitos da UI, sem Query Manager.
 */
async function runParamsRerunTurn({
  session_id,
  message,
  search_params,
  config,
  executeSearchByText,
  final_limit = 10,
  debug = false,
  rerank = false,
  auth = null,
  assertCanSearch = null,
  onSearchCompleted = null,
}) {
  const started = Date.now();
  const session = getOrCreateSession(session_id, {
    userId: auth?.userId || null,
  });

  if (typeof assertCanSearch === "function") {
    await assertCanSearch(auth || {});
  }

  const plan = await planSearchFromParams(search_params, config, {
    final_limit,
    debug,
    rerank,
  });
  const searchStarted = Date.now();
  const search = await executeSearchByText(plan.mcp_tool_call.arguments, {
    debug: plan.mcp_tool_call.arguments.debug === true,
    rerank: plan.mcp_tool_call.arguments.rerank === true,
  });
  const search_duration_ms = Date.now() - searchStarted;
  const bundle = { ...plan, search_duration_ms, search };

  const resultCount = Array.isArray(search?.results) ? search.results.length : 0;
  const reply = formatResultsMarkdown(search?.results || [], {
    intro:
      resultCount > 0
        ? `Busca refeita. Encontrei ${resultCount} fornecedor(es):`
        : "Busca refeita. Nenhum fornecedor encontrado com estes parâmetros. Tente ampliar a região ou ajustar os recortes.",
  });

  const toStore = [
    ...session.messages.filter((m) => m.role !== "system"),
    { role: "user", content: message },
    { role: "assistant", content: reply },
  ];
  setSessionMessages(session, toStore);
  setSessionLastSearch(session, bundle, search);
  onSearchCompleted?.(bundle, auth, session.id);

  return {
    session_id: session.id,
    reply,
    messages: publicMessages(session),
    actions: [
      {
        tool: "search_suppliers",
        source: "ui_params",
        intent: plan.intent,
        result_count: resultCount,
        search_id: search?.search_id,
        fallback: false,
        stages: null,
        geo: plan.geo
          ? {
              city: plan.geo.city_name,
              cities: plan.geo.cities_in_filter,
              radius_km: plan.geo.radius_km,
              uf: plan.geo.uf,
              ufs: plan.geo.ufs || null,
              scope: plan.geo.scope || null,
            }
          : null,
      },
    ],
    model: MODEL,
    duration_ms: Date.now() - started,
    tokens_used: null,
    intent: plan.intent ?? null,
    query_manager: plan.query_manager ?? null,
    geo: plan.geo ?? null,
    mcp_tool_call: plan.mcp_tool_call ?? null,
    search,
    search_duration_ms,
    reasoning: "Parâmetros explícitos da UI (sem Query Manager)",
    issued_api_key: null,
    auth: publicAuthView(auth),
    simulation: {
      client: "ui-search-params",
      role: "Refazer busca com parâmetros da aba lateral",
      tools_available: ["search_text"],
      transport: "same-process (X-Ray)",
      tool_rounds: 0,
    },
    fallback: null,
  };
}

export function resetChatSession(session_id, opts = {}) {
  const session = resetSession(session_id, {
    userId: opts.userId || null,
  });
  return {
    session_id: session.id,
    messages: [],
  };
}
