import assert from "node:assert/strict";
import { parseSearchTextBody } from "../src/schemas/searchText.js";
import { getDimensionKeys, getAuthMode, LIMITS } from "../src/config/env.js";
import { resolveAuthContext, anonymousAuth } from "../src/middleware/auth.js";
import { AppError } from "../src/errors/AppError.js";
import {
  buildFixedWeights,
  mapQueryManagerToToolArgs,
  resolveDimMap,
  resolveGeoRequest,
  QM_FIXED,
} from "../src/xray/searchAgent.js";

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
  assert.equal(getAuthMode(), "off");
  const ctx = resolveAuthContext({});
  assert.deepEqual(ctx.authenticated, anonymousAuth().authenticated);
  console.log("OK auth off passthrough");
}

{
  process.env.AUTH_MODE = "api_key";
  process.env.AUTH_API_KEYS = "sk_test_abc";
  try {
    resolveAuthContext({});
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof AppError);
    assert.equal(e.status, 401);
  }
  const ok = resolveAuthContext({ authorization: "Bearer sk_test_abc" });
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

  const regional = mapQueryManagerToToolArgs(
    { intent: "SERVICO", query_original: "limpeza", produtos: "x", servicos: "limpeza industrial", descricao: "d", publico: "p", clientes: "c", bm25: "limpeza industrial" },
    { dimension_keys: ["produto", "servico", "descricao", "publico", "cliente"], bm25: { vector_name: "bm25" } },
    { cityNames: ["Campinas", "Valinhos", "Sumaré"], geoMeta: { cities_in_filter: 3 } },
  );
  assert.deepEqual(regional.toolArguments.filter.cidade, ["Campinas", "Valinhos", "Sumaré"]);
  assert.equal(regional.query_manager.geo.cities_in_filter, 3);
  console.log("OK regional city list filter");
}

console.log("\nAll unit checks passed.");
