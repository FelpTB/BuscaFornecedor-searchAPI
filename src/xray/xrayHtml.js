/**
 * X-Ray UI — pré-proxy de agente Microsoft (Copilot + MCP).
 * Testa health, config, search_text (agente NL e tool call manual).
 */
export function getSearchXrayHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>X-Ray · Pré-proxy MCP (Microsoft)</title>
  <style>
    :root {
      --bg: #0f1419; --panel: #1a2332; --panel-2: #243044; --border: #3d4f66;
      --text: #e7ecf3; --muted: #8b9bb4; --accent: #3b82f6; --accent-2: #2563eb;
      --ok: #34d399; --warn: #fbbf24; --err: #f87171;
      --ms: #00a4ef; --mono: "Cascadia Code","Fira Code",ui-monospace,monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.45; }
    header { border-bottom: 1px solid var(--border); padding: 1rem 1.25rem; background: linear-gradient(120deg,#0f172a 0%,#1e3a5f 55%,#0f1419 100%); }
    header h1 { margin: 0; font-size: 1.2rem; }
    header p { margin: 0.35rem 0 0; color: var(--muted); font-size: 0.88rem; max-width: 920px; }
    .ms { color: var(--ms); font-weight: 700; }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 1rem 1.25rem 2.5rem; }
    .mode-tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.85rem; }
    .mode-tabs button {
      padding: 0.45rem 0.85rem; border-radius: 8px; border: 1px solid var(--border);
      background: var(--panel); color: var(--muted); font-weight: 650; cursor: pointer;
    }
    .mode-tabs button.active { color: #fff; border-color: var(--ms); background: color-mix(in srgb, var(--ms) 22%, var(--panel)); }
    .panel-mode { display: none; }
    .panel-mode.active { display: block; }
    .search-bar, .manual-bar {
      display: flex; gap: 0.6rem; flex-wrap: wrap; background: var(--panel);
      border: 1px solid var(--border); border-radius: 10px; padding: 0.85rem;
    }
    input[type="text"], input[type="password"], textarea, select {
      padding: 0.7rem 0.85rem; border-radius: 8px; border: 1px solid var(--border);
      background: var(--panel-2); color: var(--text); font-size: 0.95rem;
    }
    .search-bar input[type="text"] { flex: 1 1 280px; min-width: 200px; }
    textarea { width: 100%; min-height: 220px; font-family: var(--mono); font-size: 0.78rem; resize: vertical; }
    button.primary {
      padding: 0.7rem 1.1rem; border: none; border-radius: 8px;
      background: var(--accent); color: #fff; font-weight: 650; cursor: pointer;
    }
    button.primary:hover { background: var(--accent-2); }
    button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
    button.ghost {
      padding: 0.45rem 0.75rem; border-radius: 8px; border: 1px solid var(--border);
      background: var(--panel-2); color: var(--text); cursor: pointer; font-size: 0.82rem;
    }
    .hint { color: var(--muted); font-size: 0.82rem; margin: 0.45rem 0 0; }
    .error { color: var(--err); font-size: 0.9rem; margin-top: 0.5rem; }
    .grid { display: grid; gap: 1rem; margin-top: 1rem; }
    @media (min-width: 900px) { .grid.two { grid-template-columns: 1fr 1fr; align-items: start; } }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 1rem; }
    .card h2 { margin: 0 0 0.75rem; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 700; }
    .badge { display: inline-flex; padding: 0.15rem 0.45rem; border-radius: 999px; font-size: 0.72rem; font-weight: 650; background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); }
    .badge.ok { color: var(--ok); }
    .badge.err { color: var(--err); }
    .badge.warn { color: var(--warn); }
    .meta { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.5rem 0; }
    .reasoning, .probe-out {
      background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
      padding: 0.75rem; font-size: 0.9rem; white-space: pre-wrap;
    }
    .xray {
      font-family: var(--mono); font-size: 0.74rem; background: #0a0e14; border: 1px solid var(--border);
      border-radius: 8px; padding: 0.75rem; overflow: auto; max-height: 480px;
      white-space: pre-wrap; word-break: break-word; color: #c9d1d9; margin: 0;
    }
    .tabs { display: flex; gap: 0.35rem; margin-bottom: 0.55rem; flex-wrap: wrap; }
    .tabs button { padding: 0.35rem 0.65rem; font-size: 0.78rem; font-weight: 600; background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
    .tabs button.active { color: #fff; border-color: var(--accent); background: color-mix(in srgb, var(--accent) 25%, var(--panel-2)); }
    .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.65rem; }
    .chip { font-family: var(--mono); font-size: 0.72rem; background: #0a0e14; border: 1px solid var(--border); border-radius: 6px; padding: 0.25rem 0.45rem; color: var(--muted); }
    .chip b { color: var(--text); }
    .result { border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem; margin-bottom: 0.65rem; background: var(--panel-2); }
    .result .top { display: flex; justify-content: space-between; gap: 0.75rem; align-items: baseline; }
    .result h3 { margin: 0; font-size: 1rem; }
    .result .score { color: var(--accent); font-family: var(--mono); font-size: 0.85rem; }
    .scores { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.5rem 0; }
    .scores span { font-family: var(--mono); font-size: 0.7rem; background: #0a0e14; border: 1px solid var(--border); border-radius: 4px; padding: 0.15rem 0.35rem; color: var(--muted); }
    .payload { font-size: 0.82rem; color: var(--muted); display: grid; gap: 0.2rem; }
    .payload b { color: var(--text); font-weight: 600; }
    .opts { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-top: 0.55rem; }
    .opts label { font-size: 0.85rem; color: var(--muted); display: flex; gap: 0.35rem; align-items: center; }
    .opts input[type="number"] { width: 72px; padding: 0.3rem 0.4rem; border-radius: 6px; border: 1px solid var(--border); background: var(--panel-2); color: var(--text); }
    .step { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; font-size: 0.82rem; color: var(--muted); }
    .step.on { color: var(--ok); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); }
    .step.on .dot { background: var(--ok); }
    .auth-row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-bottom: 0.75rem; }
    .auth-row input { flex: 1 1 220px; }
    .probe-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
  </style>
</head>
<body>
  <header>
    <div class="wrap" style="padding-top:0;padding-bottom:0">
      <h1>X-Ray · Query Manager → <span class="ms">MCP / Microsoft</span></h1>
      <p>Pré-proxy do Query Manager B2B: classifica PRODUTO/SERVIÇO/MISTO, aplica <b>pesos fixos</b>, BM25 discriminante e <code>Modelo_Negocio</code>, depois chama a tool MCP <code>search_text</code> desta API.</p>
    </div>
  </header>

  <div class="wrap">
    <div class="auth-row">
      <label class="hint">API key (se AUTH_MODE=api_key)</label>
      <input type="password" id="apiKey" placeholder="Bearer / X-Api-Key (opcional)" autocomplete="off">
      <span class="badge" id="authBadge">auth: …</span>
      <span class="hint" id="configHint">Carregando /config…</span>
    </div>

    <div class="mode-tabs">
      <button type="button" class="active" data-mode="agent">1 · Query Manager (NL)</button>
      <button type="button" data-mode="manual">2 · Tool call manual</button>
      <button type="button" data-mode="probe">3 · Probes (health/config/tools)</button>
    </div>

    <div id="mode-agent" class="panel-mode active">
      <form id="formAgent" class="search-bar">
        <input type="text" id="query" placeholder="Ex.: instalação de energia solar em SP para condomínios" required autocomplete="off">
        <button type="submit" class="primary" id="btnAgent">Rodar agente</button>
      </form>
      <div class="opts">
        <label>final_limit <input type="number" id="final_limit" min="1" max="100" value="10"></label>
        <label><input type="checkbox" id="forceDebug"> debug</label>
        <label><input type="checkbox" id="forceRerank"> forçar rerank</label>
      </div>
    </div>

    <div id="mode-manual" class="panel-mode">
      <div class="manual-bar" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem">
          <button type="button" class="ghost" id="btnFillTemplate">Preencher template</button>
          <button type="button" class="ghost" id="btnFromLast">Usar último tool call</button>
          <button type="button" class="primary" id="btnManual">Executar search_text</button>
        </div>
        <textarea id="manualJson" spellcheck="false"></textarea>
        <p class="hint">JSON = arguments da tool MCP search_text (query, weights, filter, filter_not, bm25, limits, rerank, debug).</p>
      </div>
    </div>

    <div id="mode-probe" class="panel-mode">
      <div class="card">
        <h2>Probes REST / contrato MCP</h2>
        <div class="probe-actions">
          <button type="button" class="ghost" data-probe="health">GET /health</button>
          <button type="button" class="ghost" data-probe="config">GET /config</button>
          <button type="button" class="ghost" data-probe="tools">Contrato tools MCP</button>
        </div>
        <pre class="xray" id="probeOut">Clique em um probe…</pre>
      </div>
    </div>

    <div id="formError" class="error"></div>

    <div class="grid two" id="agentPanels">
      <section class="card">
        <h2>Pipeline (simulação Microsoft)</h2>
        <div class="step" id="s1"><span class="dot"></span> 1. Pedido do usuário / tool call</div>
        <div class="step" id="s2"><span class="dot"></span> 2. Query Manager (intent + BM25 discriminante)</div>
        <div class="step" id="s3"><span class="dot"></span> 3. API executa (mesmo núcleo REST/MCP)</div>
        <div class="step" id="s4"><span class="dot"></span> 4. Resultados + X-Ray</div>
        <h2 style="margin-top:1rem">Raciocínio</h2>
        <div class="reasoning" id="reasoning">Aguardando…</div>
        <div class="chips" id="paramChips"></div>
      </section>
      <section class="card">
        <h2>X-Ray · tool call MCP</h2>
        <div class="tabs" id="xrayTabs">
          <button type="button" class="active" data-tab="tool">mcp_tool_call</button>
          <button type="button" data-tab="qm">query_manager</button>
          <button type="button" data-tab="weights">weights</button>
          <button type="button" data-tab="queries">queries / filters</button>
          <button type="button" data-tab="meta">meta</button>
          <button type="button" data-tab="raw">resposta completa</button>
        </div>
        <pre class="xray" id="xray">Aguardando…</pre>
        <div class="meta" id="statusMeta"></div>
      </section>
    </div>

    <section class="card" style="margin-top:1rem" id="resultsCard">
      <h2>Resultados <span id="resultsCount" class="badge">0</span></h2>
      <div id="results"></div>
    </section>
  </div>

  <script>
    const state = { config: null, last: null, tab: "tool", mode: "agent" };
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));

    function authHeaders(extra = {}) {
      const h = { ...extra };
      const key = $("apiKey").value.trim();
      if (key) {
        h["Authorization"] = key.toLowerCase().startsWith("bearer ") ? key : ("Bearer " + key);
        h["X-Api-Key"] = key.replace(/^bearer\\s+/i, "");
      }
      return h;
    }

    function setSteps(n) {
      for (let i = 1; i <= 4; i++) $("s" + i).classList.toggle("on", i <= n);
    }

    function setMode(mode) {
      state.mode = mode;
      document.querySelectorAll(".mode-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
      document.querySelectorAll(".panel-mode").forEach((p) => p.classList.toggle("active", p.id === "mode-" + mode));
    }

    function renderChips(args) {
      if (!args) { $("paramChips").innerHTML = ""; return; }
      const chips = [];
      if (args.weights) for (const [k, v] of Object.entries(args.weights))
        chips.push("<span class='chip'><b>" + esc(k) + "</b> " + Number(v).toFixed(3) + "</span>");
      if (args.bm25_query) chips.push("<span class='chip'><b>bm25</b> " + esc(args.bm25_query) + "</span>");
      if (args.filter) chips.push("<span class='chip'><b>filter</b> " + esc(JSON.stringify(args.filter)) + "</span>");
      if (args.filter_not) chips.push("<span class='chip'><b>filter_not</b> " + esc(JSON.stringify(args.filter_not)) + "</span>");
      if (args.rerank) chips.push("<span class='chip'><b>rerank</b> on</span>");
      if (args.debug) chips.push("<span class='chip'><b>debug</b> on</span>");
      $("paramChips").innerHTML = chips.join("");
    }

    function renderXray() {
      const d = state.last;
      if (!d) { $("xray").textContent = "Aguardando…"; return; }
      const args = d.mcp_tool_call?.arguments || {};
      const map = {
        tool: d.mcp_tool_call,
        qm: d.query_manager || { note: "só no modo Agente (Query Manager)" },
        weights: args.weights || {},
        queries: {
          query: args.query,
          queries: args.queries || null,
          bm25_query: args.bm25_query ?? null,
          bm25: args.bm25,
          filter: args.filter || null,
          filter_not: args.filter_not || null,
        },
        meta: {
          simulation: d.simulation,
          intent: d.intent,
          model: d.model,
          duration_ms: d.duration_ms,
          search_duration_ms: d.search_duration_ms,
          tokens_used: d.tokens_used,
          user_query: d.user_query,
          search_id: d.search?.search_id,
          latency_ms: d.search?.latency_ms,
          embedding_model: d.search?.embedding_model,
          embedding_dims: d.search?.embedding_dims,
        },
        raw: d,
      };
      $("xray").textContent = JSON.stringify(map[state.tab] ?? map.tool, null, 2);
    }

    function renderResults(payload) {
      const results = payload?.results || [];
      $("resultsCount").textContent = String(results.length);
      if (!results.length) {
        $("results").innerHTML = "<p class='hint'>Nenhum resultado.</p>";
        return;
      }
      $("results").innerHTML = results.map((r) => {
        const scores = Object.entries(r.scores || {})
          .map(([k, v]) => "<span>" + esc(k) + ": " + Number(v).toFixed(4) + "</span>").join("");
        const p = r.payload || {};
        return (
          '<article class="result"><div class="top">' +
            '<h3>' + esc(r.posicao) + ". " + esc(p.nome_empresa || r.id) + '</h3>' +
            '<div class="score">final ' + Number(r.score_final ?? 0).toFixed(4) +
            (r.score_rrf != null ? ' · rrf ' + Number(r.score_rrf).toFixed(4) : '') + '</div></div>' +
            '<div class="scores">' + scores + '</div>' +
            '<div class="payload">' +
              '<div><b>CNPJ</b> ' + esc(p.cnpj || "—") + ' · <b>UF</b> ' + esc(p.uf || "—") +
              ' · <b>Cidade</b> ' + esc(p.cidade || "—") + '</div>' +
              '<div><b>Modelo</b> ' + esc(p.modelo_negocio || "—") + '</div>' +
              '<div><b>Descrição</b> ' + esc((p.descricao || "").slice(0, 280)) +
              ((p.descricao || "").length > 280 ? "…" : "") + '</div></div></article>'
        );
      }).join("");
    }

    function showRun(data, opts = {}) {
      state.last = data;
      setSteps(4);
      $("reasoning").textContent = data.reasoning || opts.reasoning || "(tool call manual — sem reasoning LLM)";
      renderChips(data.mcp_tool_call?.arguments);
      state.tab = "tool";
      document.querySelectorAll("#xrayTabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === "tool"));
      renderXray();
      renderResults(data.search);
      $("statusMeta").innerHTML =
        '<span class="badge ok">' + esc(data.mcp_tool_call?.name || "search_text") + '</span>' +
        (data.intent ? '<span class="badge warn">intent ' + esc(data.intent) + '</span>' : '') +
        (data.model ? '<span class="badge">' + esc(data.model) + '</span>' : '') +
        (data.duration_ms != null ? '<span class="badge">agent ' + esc(data.duration_ms) + ' ms</span>' : '') +
        '<span class="badge">search ' + esc(data.search_duration_ms) + ' ms</span>' +
        (data.search?.search_id ? '<span class="badge">id ' + esc(data.search.search_id.slice(0, 8)) + '…</span>' : '') +
        '<span class="badge">' + (data.search?.results?.length || 0) + ' results</span>';
    }

    async function loadConfig() {
      const res = await fetch("/config", { headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || ("HTTP " + res.status + " em /config"));
      }
      state.config = await res.json();
      const auth = state.config.auth || {};
      $("authBadge").textContent = "auth: " + (auth.mode || "?") + (auth.required ? " (required)" : " (off)");
      $("authBadge").className = "badge " + (auth.required ? "warn" : "ok");
      $("configHint").textContent =
        "dims: " + (state.config.dimension_keys || []).join(", ") +
        (state.config.bm25?.vector_name ? " · BM25 on" : " · BM25 off") +
        " · limits ≤" + (state.config.limits?.final_limit_max || 100);
    }

    function templateArgs() {
      const dims = state.config?.dimension_keys || ["produto","servico","descricao","publico","cliente"];
      const w = {};
      const eq = 1 / dims.length;
      dims.forEach((d) => { w[d] = Number(eq.toFixed(4)); });
      return {
        query: "energia solar residencial",
        queries: Object.fromEntries(dims.map((d) => [d, "energia solar"])),
        weights: w,
        filter: { uf: "SP" },
        filter_not: {},
        bm25: true,
        bm25_query: "energia solar fotovoltaica",
        limit_per_vector: 50,
        final_limit: 10,
        rerank: false,
        debug: false,
      };
    }

    async function runAgent(e) {
      e.preventDefault();
      $("formError").textContent = "";
      $("statusMeta").innerHTML = "";
      const btn = $("btnAgent");
      btn.disabled = true;
      btn.textContent = "Agente pensando…";
      setSteps(1);
      $("reasoning").textContent = "Planejando tool call MCP (estilo Copilot)…";
      try {
        setSteps(2);
        const body = {
          query: $("query").value.trim(),
          final_limit: Number($("final_limit").value) || 10,
          debug: $("forceDebug").checked,
          rerank: $("forceRerank").checked,
        };
        const res = await fetch("/search/xray/run", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
        setSteps(3);
        showRun(data);
      } catch (err) {
        setSteps(1);
        $("formError").textContent = err.message || String(err);
        $("statusMeta").innerHTML = '<span class="badge err">erro</span>';
      } finally {
        btn.disabled = false;
        btn.textContent = "Rodar agente";
      }
    }

    async function runManual() {
      $("formError").textContent = "";
      let args;
      try { args = JSON.parse($("manualJson").value); }
      catch { $("formError").textContent = "JSON inválido no editor"; return; }
      $("btnManual").disabled = true;
      setSteps(1);
      $("reasoning").textContent = "Tool call manual (sem LLM)…";
      try {
        setSteps(3);
        const res = await fetch("/search/xray/tool", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ arguments: args }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
        showRun(data, { reasoning: "Execução direta da tool search_text (prévia de cliente MCP sem NL)." });
      } catch (err) {
        setSteps(1);
        $("formError").textContent = err.message || String(err);
      } finally {
        $("btnManual").disabled = false;
      }
    }

    async function runProbe(kind) {
      $("formError").textContent = "";
      try {
        if (kind === "health") {
          const res = await fetch("/health");
          $("probeOut").textContent = JSON.stringify(await res.json(), null, 2);
          return;
        }
        if (kind === "config") {
          await loadConfig();
          $("probeOut").textContent = JSON.stringify(state.config, null, 2);
          return;
        }
        if (kind === "tools") {
          const cfg = state.config || (await loadConfig(), state.config);
          $("probeOut").textContent = JSON.stringify({
            mcp_endpoint: cfg?.mcp?.endpoint || "/mcp",
            tools: [
              { name: "get_config", mirrors: "GET /config", input: {} },
              { name: "search_text", mirrors: "POST /search/text", input_from: "schemas/searchText.js" },
            ],
            auth: cfg?.auth,
            note: "No Microsoft: cliente MCP Streamable HTTP chama as mesmas tools.",
          }, null, 2);
        }
      } catch (err) {
        $("formError").textContent = err.message || String(err);
        $("probeOut").textContent = String(err);
      }
    }

    document.querySelectorAll(".mode-tabs button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    document.querySelectorAll("#xrayTabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tab = btn.dataset.tab;
        document.querySelectorAll("#xrayTabs button").forEach((b) => b.classList.toggle("active", b === btn));
        renderXray();
      });
    });
    document.querySelectorAll("[data-probe]").forEach((b) => b.addEventListener("click", () => runProbe(b.dataset.probe)));
    $("formAgent").addEventListener("submit", runAgent);
    $("btnManual").addEventListener("click", runManual);
    $("btnFillTemplate").addEventListener("click", () => {
      $("manualJson").value = JSON.stringify(templateArgs(), null, 2);
    });
    $("btnFromLast").addEventListener("click", () => {
      const args = state.last?.mcp_tool_call?.arguments;
      if (!args) { $("formError").textContent = "Nenhum tool call ainda"; return; }
      $("manualJson").value = JSON.stringify(args, null, 2);
      setMode("manual");
    });
    $("apiKey").addEventListener("change", () => loadConfig().catch(() => {}));

    loadConfig()
      .then(() => { $("manualJson").value = JSON.stringify(templateArgs(), null, 2); })
      .catch((err) => {
        $("configHint").textContent = "Erro: " + err.message;
        $("formError").textContent = err.message;
      });
  </script>
</body>
</html>`;
}
