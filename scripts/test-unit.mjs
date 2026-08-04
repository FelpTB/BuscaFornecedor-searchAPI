/**
 * Smoke unitário sem Qdrant/OpenAI — schema + auth + env defaults.
 *   node scripts/test-unit.mjs
 */
import assert from "node:assert/strict";
import { parseSearchTextBody } from "../src/schemas/searchText.js";
import { getDimensionKeys, getAuthMode, LIMITS } from "../src/config/env.js";
import { resolveAuthContext, anonymousAuth } from "../src/middleware/auth.js";
import { AppError } from "../src/errors/AppError.js";

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

console.log("\nAll unit checks passed.");
