import assert from "node:assert/strict";
import { parseSearchTextBody } from "../src/schemas/searchText.js";
import { getDimensionKeys, getAuthMode, LIMITS } from "../src/config/env.js";
import { resolveAuthContext } from "../src/middleware/auth.js";
import { AppError } from "../src/errors/AppError.js";
import { hashApiKey, generateApiKey } from "../src/auth/apiKeyHash.js";
import { summarizeResultsForStorage } from "../src/db/repositories/consultasRepo.js";
import {
  buildFixedWeights,
  mapQueryManagerToToolArgs,
  resolveDimMap,
  resolveGeoRequest,
  resolveUfFilter,
  normalizeUfList,
  formatUfFilterValue,
  QM_FIXED,
} from "../src/xray/searchAgent.js";
import { CHAT_TOOLS } from "../src/xray/conversationalAgent.js";
import {
  getOrCreateSession,
  resetSession,
  setSessionMessages,
  publicMessages,
  sanitizeOpenAiMessages,
  _clearAllSessionsForTests,
} from "../src/xray/chatSessions.js";
import {
  buildFallbackStages,
  extractCnpjs,
  mergeUniqueResults,
  runFallbackCascade,
  stripGeoFilter,
} from "../src/search/fallbackSearch.js";

process.env.AUTH_MODE = "off";
process.env.QDRANT_DIMENSION_KEYS =
  process.env.QDRANT_DIMENSION_KEYS || "produto,servico,descricao,publico,cliente";

{
  const dims = getDimensionKeys();
  assert.equal(dims.length, 5);
  assert.ok(dims.includes("produto"));
  console.log("OK config dimensions");
}

{
  const ok = parseSearchTextBody({
    query: "energia solar",
    weights: { produto: 0.4, servico: 0.3, descricao: 0.1, publico: 0.1, cliente: 0.1 },
    filter: { uf: "SP" },
    final_limit: 10,
  });
  assert.equal(ok.success, true);
  assert.equal(ok.data.query, "energia solar");
  console.log("OK schema search_text");
}

{
  const bad = parseSearchTextBody({ query: "" });
  assert.equal(bad.success, false);
  console.log("OK schema rejects empty query");
}

{
  const over = parseSearchTextBody({
    query: "x",
    final_limit: LIMITS.finalLimitMax + 1,
  });
  assert.equal(over.success, false);
  console.log("OK schema enforces final_limit max");
}

{
  process.env.AUTH_MODE = "off";
  const ctx = await resolveAuthContext({});
  assert.equal(ctx.authenticated, false);
  console.log("OK auth off passthrough");
}

{
  process.env.AUTH_MODE = "api_key";
  process.env.AUTH_API_KEYS = "sk_test_abc";
  // Sem credencial → anônimo (register/login/config). Gate de busca = assertCanSearch.
  const anon = await resolveAuthContext({});
  assert.equal(anon.authenticated, false);
  assert.equal(anon.provider, "anonymous");
  try {
    await resolveAuthContext({}, { optional: false });
    assert.fail("should throw when optional=false");
  } catch (e) {
    assert.ok(e instanceof AppError);
    assert.equal(e.status, 401);
  }
  const { assertCanSearch } = await import("../src/auth/resolveAuth.js");
  try {
    assertCanSearch(anon);
    assert.fail("assertCanSearch should block anonymous when AUTH_MODE=api_key");
  } catch (e) {
    assert.ok(e instanceof AppError);
    assert.equal(e.status, 401);
  }
  const ok = await resolveAuthContext({ authorization: "Bearer sk_test_abc" });
  assert.equal(ok.authenticated, true);
  console.log("OK auth api_key");
  process.env.AUTH_MODE = "off";
}

{
  const dimMap = resolveDimMap(["produto", "servico", "descricao", "publico", "cliente"]);
  const wP = buildFixedWeights("PRODUTO", dimMap, true);
  const sumP = Object.values(wP).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumP - 1) < 1e-6, `sum=${sumP}`);
  assert.equal(wP.produto, 0.45);
  assert.equal(wP.servico, 0.15);
  assert.equal(wP.bm25, QM_FIXED.bm25);

  const wS = buildFixedWeights("SERVICO", dimMap, true);
  assert.equal(wS.servico, 0.45);
  assert.equal(wS.produto, 0.15);

  const wM = buildFixedWeights("MISTO", dimMap, true);
  assert.equal(wM.produto, 0.3);
  assert.equal(wM.servico, 0.3);
  console.log("OK Query Manager fixed weights");
}

{
  const mapped = mapQueryManagerToToolArgs(
    {
      intent: "PRODUTO",
      query_original: "caroço de açaí",
      produtos: "caroço de açaí seco, semente de açaí",
      servicos: "beneficiamento de caroço de açaí",
      descricao: "biomassa",
      publico: "indústrias",
      clientes: "compradores",
      bm25: "caroço caroços semente sementes biomassa",
      Modelo_Negocio: "Fabricante",
      uf: "PA",
    },
    {
      dimension_keys: ["produto", "servico", "descricao", "publico", "cliente"],
      bm25: { vector_name: "bm25_complete_profile" },
    },
    { final_limit: 10 },
  );
  assert.equal(mapped.intent, "PRODUTO");
  assert.equal(mapped.toolArguments.filter.modelo_negocio, "Fabricante");
  assert.equal(mapped.toolArguments.filter.uf, "PA");
  assert.equal(mapped.toolArguments.bm25_query.includes("açaí"), false);
  assert.ok(mapped.toolArguments.queries.produto.includes("caroço"));
  console.log("OK Query Manager → search_text mapping");
}

{
  const g = resolveGeoRequest(
    { cidade_centro: "Campinas", uf: "SP", radius_km: 30 },
    {},
  );
  assert.equal(g.city_name, "Campinas");
  assert.equal(g.uf, "SP");
  assert.equal(g.radius_km, 30);

  const uiWins = resolveGeoRequest(
    { cidade_centro: "Campinas", uf: "SP", radius_km: 30 },
    { city_name: "São Paulo", uf: "SP", radius_km: 50 },
  );
  assert.equal(uiWins.city_name, "São Paulo");
  assert.equal(uiWins.radius_km, 50);

  // UF-only: resolveGeoRequest returns null (sem cidade); resolveUfFilter aplica
  assert.equal(resolveGeoRequest({ uf: "MG" }, {}), null);
  assert.deepEqual(resolveUfFilter({ uf: "MG" }, {}), ["MG"]);
  assert.deepEqual(resolveUfFilter({}, { uf: "SP,RJ" }), ["SP", "RJ"]);
  assert.deepEqual(normalizeUfList("Minas Gerais"), ["MG"]);
  assert.deepEqual(normalizeUfList(["sp", "rj", "MG"]), ["SP", "RJ", "MG"]);
  assert.equal(formatUfFilterValue(["SP"]), "SP");
  assert.deepEqual(formatUfFilterValue(["SP", "RJ"]), ["SP", "RJ"]);

  const regional = mapQueryManagerToToolArgs(
    { intent: "SERVICO", query_original: "limpeza", produtos: "x", servicos: "limpeza industrial", descricao: "d", publico: "p", clientes: "c", bm25: "limpeza industrial" },
    { dimension_keys: ["produto", "servico", "descricao", "publico", "cliente"], bm25: { vector_name: "bm25" } },
    { cityNames: ["Campinas", "Valinhos", "Sumaré"], geoMeta: { cities_in_filter: 3 } },
  );
  assert.deepEqual(regional.toolArguments.filter.cidade, ["Campinas", "Valinhos", "Sumaré"]);
  assert.equal(regional.query_manager.geo.cities_in_filter, 3);

  const ufOnly = mapQueryManagerToToolArgs(
    {
      intent: "PRODUTO",
      query_original: "embalagens em SP",
      produtos: "embalagens",
      servicos: "fornecimento",
      descricao: "d",
      publico: "p",
      clientes: "c",
      bm25: "embalagens",
      uf: "SP",
    },
    {
      dimension_keys: ["produto", "servico", "descricao", "publico", "cliente"],
      bm25: { vector_name: "bm25" },
    },
  );
  assert.equal(ufOnly.toolArguments.filter.uf, "SP");
  assert.ok(!ufOnly.toolArguments.filter.cidade);

  const multiUf = mapQueryManagerToToolArgs(
    {
      intent: "PRODUTO",
      query_original: "aço RJ e MG",
      produtos: "aço",
      servicos: "x",
      descricao: "d",
      publico: "p",
      clientes: "c",
      bm25: "aço",
      uf: "RJ,MG",
    },
    {
      dimension_keys: ["produto", "servico", "descricao", "publico", "cliente"],
      bm25: { vector_name: "bm25" },
    },
    { ufs: ["RJ", "MG"] },
  );
  assert.deepEqual(multiUf.toolArguments.filter.uf, ["RJ", "MG"]);

  // UI/agente UF explícita vence QM
  const uiUfWins = mapQueryManagerToToolArgs(
    {
      intent: "PRODUTO",
      query_original: "x",
      produtos: "x",
      servicos: "x",
      descricao: "d",
      publico: "p",
      clientes: "c",
      bm25: "x",
      uf: "BA",
    },
    {
      dimension_keys: ["produto", "servico", "descricao", "publico", "cliente"],
      bm25: { vector_name: "bm25" },
    },
    { ufs: ["PR", "SC"] },
  );
  assert.deepEqual(uiUfWins.toolArguments.filter.uf, ["PR", "SC"]);
  console.log("OK regional city list + UF filter");
}

{
  const names = CHAT_TOOLS.map((t) => t.function.name).sort();
  assert.ok(names.includes("register_buyer"));
  assert.ok(names.includes("search_suppliers"));
  assert.ok(names.includes("expand_search_fallback"));
  assert.ok(names.includes("get_my_profile"));
  assert.ok(names.includes("lookup_cities"));
  assert.ok(names.includes("get_search_config"));
  const searchTool = CHAT_TOOLS.find((t) => t.function.name === "search_suppliers");
  assert.ok(searchTool.function.parameters.required.includes("briefing"));
  console.log("OK chat tool schemas");
}

{
  const k = generateApiKey();
  assert.ok(k.plaintext.startsWith("sk_bf_"));
  assert.equal(hashApiKey(k.plaintext), k.key_hash);
  const summary = summarizeResultsForStorage([
    { posicao: 1, id: "a", score_final: 0.9, payload: { cnpj: "12.345", nome_empresa: "X", cidade: "SP", uf: "SP" } },
  ]);
  assert.equal(summary[0].nome_empresa, "X");
  assert.equal(summary[0].cnpj, "12345");

  const {
    buildConsultaParamFields,
    toCanonicalResultItems,
    positionToNota,
    applyPositionNotas,
  } = await import("../src/db/repositories/consultasRepo.js");
  assert.equal(positionToNota(0, 1), 100);
  assert.equal(positionToNota(0, 5), 100);
  assert.equal(positionToNota(4, 5), 75);
  assert.equal(positionToNota(2, 5), 88); // 100 - 50/4 = 87.5 → 88
  assert.equal(positionToNota(4, 5, { escopo: "nacional" }), 100);
  const fields = buildConsultaParamFields({
    query: "energia solar",
    intent: "MISTO",
    filter: { cidade: ["São Paulo"], modelo_negocio: "Prestador de Serviço" },
    queries: { descricao: "instalar solar" },
    weights: { produto: 0.5 },
  });
  assert.equal(fields.parametros.descricao, "energia solar");
  assert.equal(fields.parametros.tipo_busca, "city");
  assert.equal(fields.parametros.cidade_origem, "São Paulo");
  assert.equal(fields.qualidade, null);
  assert.equal(fields.parametros.raw.intent, "MISTO");
  assert.ok(fields.bm_25);
  const withNotas = applyPositionNotas([
    { posicao: 1, id: "99", cnpj_basico: "12345678", nome_empresa: "ACME", score_final: 0.8 },
    { posicao: 2, id: "98", cnpj_basico: "87654321", nome_empresa: "Beta", escopo: "nacional" },
  ]);
  assert.equal(withNotas[0].nota, 100);
  assert.equal(withNotas[1].nota, 100);
  const canon = toCanonicalResultItems(
    withNotas,
    "11111111-1111-1111-1111-111111111111",
  );
  assert.equal(canon[0].item.razao_social, "ACME");
  assert.equal(canon[0].item.nota, 100);
  assert.equal(canon[1].item.nota, 100);
  assert.equal(canon[0].item.cnpj_basico, "12345678");
  assert.equal(canon[0].item["limite_listagens "], "10");
  console.log("OK api key hash + results summary");
}

{
  _clearAllSessionsForTests();
  const a = getOrCreateSession(null);
  assert.ok(a.id);
  const b = getOrCreateSession(a.id);
  assert.equal(b.id, a.id);
  setSessionMessages(a, [
    { role: "user", content: "oi" },
    { role: "assistant", content: "olá", tool_calls: [{ id: "1" }] },
    { role: "tool", tool_call_id: "1", content: "{}" },
    { role: "assistant", content: "pronto" },
  ]);
  const pub = publicMessages(a);
  assert.equal(pub.length, 3);
  assert.equal(pub[0].role, "user");
  assert.ok(!pub.some((m) => m.role === "tool"));
  const fresh = resetSession(a.id);
  assert.notEqual(fresh.id, a.id);
  assert.equal(fresh.messages.length, 0);
  console.log("OK chat sessions");
}

{
  // Orphan tool + incomplete tool_calls must be dropped (OpenAI rejects otherwise)
  const cleaned = sanitizeOpenAiMessages([
    { role: "tool", tool_call_id: "orphan", content: "{}" },
    { role: "user", content: "busca" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "tc1", function: { name: "search_suppliers", arguments: "{}" } }],
    },
    // missing tool response for tc1 — drop whole chain
    { role: "user", content: "ok" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "tc2", function: { name: "get_search_config", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "tc2", content: '{"ok":true}' },
    { role: "assistant", content: "config ok" },
  ]);
  assert.equal(cleaned[0].role, "user");
  assert.equal(cleaned[0].content, "busca");
  assert.equal(cleaned[1].role, "user");
  assert.equal(cleaned[1].content, "ok");
  assert.equal(cleaned[2].role, "assistant");
  assert.ok(cleaned[2].tool_calls);
  assert.equal(cleaned[3].role, "tool");
  assert.equal(cleaned[4].content, "config ok");

  _clearAllSessionsForTests();
  const s = getOrCreateSession("trim-test");
  const long = [];
  for (let i = 0; i < 30; i++) {
    long.push({ role: "user", content: `u${i}` });
    long.push({ role: "assistant", content: `a${i}` });
  }
  // Append a tool chain at the end that would be split by naive slice
  long.push({
    role: "assistant",
    content: null,
    tool_calls: [{ id: "last", function: { name: "lookup_cities", arguments: "{}" } }],
  });
  long.push({ role: "tool", tool_call_id: "last", content: "{}" });
  long.push({ role: "assistant", content: "cidades ok" });
  setSessionMessages(s, long);
  assert.ok(s.messages.length <= 40);
  const roles = s.messages.map((m) => m.role);
  // No leading orphan tool; if any tool present, previous must be assistant with tool_calls
  for (let i = 0; i < s.messages.length; i++) {
    if (s.messages[i].role === "tool") {
      assert.equal(s.messages[i - 1]?.role, "assistant");
      assert.ok(Array.isArray(s.messages[i - 1].tool_calls));
    }
  }
  assert.ok(roles.includes("tool") || s.messages.at(-1)?.content === "cidades ok");
  console.log("OK chat message sanitize / trim");
}

{
  assert.deepEqual(stripGeoFilter({ cidade: ["A"], uf: "SP", modelo_negocio: "Fabricante" }), {
    modelo_negocio: "Fabricante",
  });
  const stages = buildFallbackStages(
    { filter: { cidade: ["Campinas", "Valinhos"], modelo_negocio: "Distribuidor" } },
    { geo: { uf: "SP" } },
    [{ payload: { uf: "SP" } }],
  );
  assert.equal(stages.length, 2);
  assert.equal(stages[0].name, "uf");
  assert.equal(stages[0].filter.uf, "SP");
  assert.equal(stages[0].filter.modelo_negocio, "Distribuidor");
  assert.ok(!stages[0].filter.cidade);
  assert.equal(stages[1].name, "nacional");
  assert.ok(!stages[1].filter.uf);

  const alreadyNational = buildFallbackStages({ filter: { modelo_negocio: "Varejo" } }, null, []);
  assert.equal(alreadyNational.length, 0);

  const existing = [
    { posicao: 1, payload: { cnpj: "111", nome_empresa: "A" } },
    { posicao: 2, payload: { cnpj: "222", nome_empresa: "B" } },
  ];
  assert.deepEqual(extractCnpjs(existing), ["111", "222"]);
  const excluded = new Set(extractCnpjs(existing));
  const merged = mergeUniqueResults(
    existing,
    [
      { payload: { cnpj: "222", nome_empresa: "B-dup" } },
      { payload: { cnpj: "333", nome_empresa: "C" } },
    ],
    10,
    excluded,
  );
  assert.equal(merged.added, 1);
  assert.equal(merged.results.length, 3);
  assert.equal(merged.results[2].payload.cnpj, "333");
  assert.equal(merged.results[2].posicao, 3);

  let calls = 0;
  const cascade = await runFallbackCascade({
    baseArgs: {
      query: "teste",
      weights: { produto: 1 },
      filter: { cidade: ["Campinas"], uf: "SP" },
      final_limit: 5,
    },
    plan: { geo: { uf: "SP", city_name: "Campinas" } },
    existingResults: [
      { posicao: 1, payload: { cnpj: "1", nome_empresa: "Old" } },
    ],
    finalLimit: 3,
    executeSearchByText: async (args) => {
      calls += 1;
      if (args.filter?.uf && !args.filter?.cidade) {
        return {
          results: [
            { payload: { cnpj: "1", nome_empresa: "dup" } },
            { payload: { cnpj: "2", nome_empresa: "UF-new" } },
          ],
        };
      }
      return {
        results: [{ payload: { cnpj: "3", nome_empresa: "Nac" } }],
      };
    },
  });
  assert.equal(cascade.ok, true);
  assert.equal(cascade.fallback, true);
  assert.equal(cascade.mode, "fill");
  assert.equal(cascade.result_count, 3);
  assert.equal(cascade.filled, true);
  assert.ok(cascade.expanded);
  assert.ok(calls >= 1);
  assert.ok(cascade.results.some((r) => r.payload.cnpj === "2"));

  // Bug fix: cota já cheia (10/10) ainda deve ampliar o filtro e preferir NOVAS
  let nationalCalls = 0;
  let sawCityFilter = false;
  const replaceCascade = await runFallbackCascade({
    baseArgs: {
      query: "polvo",
      weights: { produto: 1 },
      filter: { cidade: ["Varginha", "Tres Pontas"], uf: "MG" },
      final_limit: 10,
    },
    plan: { geo: { uf: "MG", city_name: "Varginha" } },
    existingResults: Array.from({ length: 10 }, (_, i) => ({
      posicao: i + 1,
      payload: { cnpj: `old${i}`, nome_empresa: `Old${i}`, cidade: "Varginha", uf: "MG" },
    })),
    finalLimit: 10,
    scope: "nacional",
    mode: "replace",
    executeSearchByText: async (args) => {
      nationalCalls += 1;
      if (args.filter?.cidade) sawCityFilter = true;
      assert.ok(!args.filter?.cidade, "nacional não pode manter filter.cidade");
      assert.ok(!args.filter?.uf, "nacional não pode manter filter.uf");
      assert.ok(Array.isArray(args.filter_not?.cnpj));
      assert.equal(args.filter_not.cnpj.length, 10);
      return {
        results: [
          { payload: { cnpj: "old0", nome_empresa: "dup" } },
          { payload: { cnpj: "new1", nome_empresa: "Nacional A", uf: "SP" } },
          { payload: { cnpj: "new2", nome_empresa: "Nacional B", uf: "RJ" } },
        ],
      };
    },
  });
  assert.equal(nationalCalls, 1);
  assert.equal(sawCityFilter, false);
  assert.equal(replaceCascade.mode, "replace");
  assert.equal(replaceCascade.expanded, true);
  assert.equal(replaceCascade.new_count, 2);
  assert.equal(replaceCascade.result_count, 2);
  assert.ok(replaceCascade.results.every((r) => String(r.payload.cnpj).startsWith("new")));
  assert.ok(!replaceCascade.results.some((r) => r.payload.cidade === "Varginha"));
  console.log("OK fallback cascade");
}

{
  const { mapResultsForDisplay, cnpjBasicoFromPayload, profileUrlFromPayload, localFromPayload } =
    await import("../src/search/resultDisplay.js");
  assert.equal(cnpjBasicoFromPayload({ cnpj: "97.030.720" }), "97030720");
  assert.equal(cnpjBasicoFromPayload({ cnpj: "12345678000199" }), "12345678");
  assert.equal(
    profileUrlFromPayload({ cnpj_basico: "07160279" }),
    "https://buscafornecedor.com.br/perfil/07160279",
  );
  assert.equal(localFromPayload({ uf: "rs", cidade: "Novo Hamburgo" }), "RS · Novo Hamburgo");
  const mapped = mapResultsForDisplay([
    {
      posicao: 1,
      payload: {
        nome_empresa: "ACME",
        uf: "SP",
        cidade: "Campinas",
        modelo_negocio: "Distribuidor",
        descricao: "Teste",
        site: "www.acme.com.br",
        cnpj: "12345678000199",
      },
    },
  ]);
  assert.equal(mapped[0].local, "SP · Campinas");
  assert.equal(mapped[0].site, "https://www.acme.com.br");
  assert.equal(mapped[0].site_md, "[acme.com.br](https://www.acme.com.br)");
  assert.equal(mapped[0].perfil_url, "https://buscafornecedor.com.br/perfil/12345678");
  assert.equal(mapped[0].perfil_md, "[Perfil Acme](https://buscafornecedor.com.br/perfil/12345678)");
  assert.equal(mapped[0].cnpj_basico, "12345678");
  assert.equal(localFromPayload({ uf: "al", cidade: "MACEIO" }), "AL · Maceio");
  console.log("OK result display mapping");
}

{
  const {
    buildMessageRows,
    deriveConversationTitle,
  } = await import("../src/db/repositories/conversasRepo.js");
  const {
    buildPersistableMessages,
    persistConversationTurn,
  } = await import("../src/conversations/persistChat.js");

  assert.equal(deriveConversationTitle([{ role: "assistant", content: "oi" }]), null);
  assert.equal(
    deriveConversationTitle([{ role: "user", content: "  preciso de aço em SP  " }]),
    "preciso de aço em SP",
  );
  const long = "x".repeat(100);
  assert.equal(deriveConversationTitle([{ role: "user", content: long }]).endsWith("…"), true);

  const rows = buildMessageRows([
    { role: "system", content: "ignore" },
    { role: "user", content: "olá" },
    { role: "assistant", content: "oi" },
    { role: "tool", content: null, metadata: { search_id: "abc" } },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].seq, 1);
  assert.equal(rows[2].role, "tool");
  assert.equal(rows[2].metadata.search_id, "abc");

  const persistable = buildPersistableMessages({
    messages: [
      { role: "user", content: "busca embalagens" },
      { role: "assistant", content: "encontrei…" },
    ],
    search: {
      search_id: "11111111-1111-1111-1111-111111111111",
      results: [
        { posicao: 1, payload: { cnpj: "12345678000199", nome_empresa: "ACME", uf: "SP", cidade: "Campinas" } },
      ],
    },
    actions: [{ tool: "search_suppliers" }],
  });
  assert.equal(persistable.length, 3);
  assert.equal(persistable[2].role, "tool");
  assert.equal(persistable[2].metadata.result_count, 1);
  assert.equal(persistable[2].metadata.results[0].cnpj, "12345678000199");

  const skipped = persistConversationTurn({
    auth: null,
    sessionId: "11111111-1111-1111-1111-111111111111",
    messages: [{ role: "user", content: "x" }],
  });
  assert.equal(skipped.queued, false);

  console.log("OK conversation persist helpers");
}

console.log("\nAll unit checks passed.");
