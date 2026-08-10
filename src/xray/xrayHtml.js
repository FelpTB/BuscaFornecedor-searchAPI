/**
 * X-Ray UI — chat conversacional (pré-proxy Microsoft Copilot + MCP).
 * Modo principal: conversa NL multi-turn. Secundários: tool manual + probes.
 */
export function getSearchXrayHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>X-Ray · Chat BuscaFornecedor</title>
  <style>
    :root {
      --bg: #0f1419; --panel: #1a2332; --panel-2: #243044; --border: #3d4f66;
      --text: #e7ecf3; --muted: #8b9bb4; --accent: #3b82f6; --accent-2: #2563eb;
      --ok: #34d399; --warn: #fbbf24; --err: #f87171;
      --ms: #00a4ef; --user: #1e3a5f; --bot: #243044;
      --mono: "Cascadia Code","Fira Code",ui-monospace,monospace;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0; font-family: "Segoe UI", system-ui, sans-serif;
      background: var(--bg); color: var(--text); line-height: 1.45;
      display: flex; flex-direction: column; min-height: 100vh;
    }
    header {
      border-bottom: 1px solid var(--border); padding: 0.85rem 1.25rem;
      background: linear-gradient(120deg,#0f172a 0%,#1e3a5f 55%,#0f1419 100%);
      flex: 0 0 auto;
    }
    header h1 { margin: 0; font-size: 1.15rem; }
    header p { margin: 0.3rem 0 0; color: var(--muted); font-size: 0.85rem; max-width: 960px; }
    .ms { color: var(--ms); font-weight: 700; }
    .wrap { max-width: 1280px; margin: 0 auto; padding: 0.75rem 1.25rem 1.5rem; width: 100%; flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .auth-row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-bottom: 0.65rem; flex: 0 0 auto; }
    .auth-row input { flex: 1 1 200px; }
    .mode-tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.75rem; flex: 0 0 auto; }
    .mode-tabs button {
      padding: 0.4rem 0.8rem; border-radius: 8px; border: 1px solid var(--border);
      background: var(--panel); color: var(--muted); font-weight: 650; cursor: pointer;
    }
    .mode-tabs button.active { color: #fff; border-color: var(--ms); background: color-mix(in srgb, var(--ms) 22%, var(--panel)); }
    .panel-mode { display: none; flex: 1; min-height: 0; flex-direction: column; }
    .panel-mode.active { display: flex; }
    input[type="text"], input[type="password"], textarea, select {
      padding: 0.65rem 0.8rem; border-radius: 8px; border: 1px solid var(--border);
      background: var(--panel-2); color: var(--text); font-size: 0.95rem;
    }
    textarea { width: 100%; font-family: inherit; resize: none; }
    button.primary {
      padding: 0.65rem 1rem; border: none; border-radius: 8px;
      background: var(--accent); color: #fff; font-weight: 650; cursor: pointer;
    }
    button.primary:hover { background: var(--accent-2); }
    button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
    button.ghost {
      padding: 0.4rem 0.7rem; border-radius: 8px; border: 1px solid var(--border);
      background: var(--panel-2); color: var(--text); cursor: pointer; font-size: 0.82rem;
    }
    .hint { color: var(--muted); font-size: 0.82rem; margin: 0.35rem 0 0; }
    .error { color: var(--err); font-size: 0.9rem; margin-top: 0.4rem; }
    .badge {
      display: inline-flex; padding: 0.15rem 0.45rem; border-radius: 999px;
      font-size: 0.72rem; font-weight: 650; background: var(--panel-2); color: var(--muted); border: 1px solid var(--border);
    }
    .badge.ok { color: var(--ok); }
    .badge.err { color: var(--err); }
    .badge.warn { color: var(--warn); }

    /* Chat layout */
    .chat-layout {
      display: grid; gap: 0.85rem; flex: 1; min-height: 0;
      grid-template-columns: 1fr;
    }
    @media (min-width: 960px) {
      .chat-layout { grid-template-columns: minmax(320px, 1.05fr) minmax(300px, 0.95fr); }
    }
    .chat-pane, .side-pane {
      background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
      display: flex; flex-direction: column; min-height: 0; overflow: hidden;
    }
    .chat-pane { min-height: 420px; }
    .side-pane { min-height: 320px; }
    .pane-head {
      padding: 0.7rem 0.9rem; border-bottom: 1px solid var(--border);
      display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;
    }
    .pane-head h2 {
      margin: 0; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--muted); font-weight: 700;
    }
    .thread {
      flex: 1; overflow: auto; padding: 1rem 0.9rem; display: flex; flex-direction: column; gap: 0.75rem;
      background: #121820;
    }
    .bubble {
      max-width: 92%; padding: 0.7rem 0.85rem; border-radius: 12px;
      word-break: break-word; font-size: 0.92rem; line-height: 1.55;
    }
    .bubble.user {
      align-self: flex-end; background: var(--user); border: 1px solid #2d4a73;
      border-bottom-right-radius: 4px; white-space: pre-wrap;
    }
    .bubble.assistant {
      align-self: flex-start; background: var(--bot); border: 1px solid var(--border);
      border-bottom-left-radius: 4px;
    }
    .bubble .who {
      display: block; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--muted); margin-bottom: 0.35rem; font-weight: 700;
    }
    .bubble .md p { margin: 0 0 0.55rem; }
    .bubble .md p:last-child { margin-bottom: 0; }
    .bubble .md strong { color: #f1f5f9; font-weight: 650; }
    .bubble .md a {
      color: #7dd3fc; text-decoration: underline; text-underline-offset: 2px;
    }
    .bubble .md a:hover { color: #bae6fd; }
    .bubble .md .md-p { margin: 0 0 0.45rem; }
    .bubble .md .md-gap { height: 0.55rem; }
    .bubble .md .md-item {
      margin: 0.75rem 0 0.25rem; font-size: 0.98rem;
    }
    .bubble .md .md-item:first-child { margin-top: 0.25rem; }
    .bubble .md .md-n { color: var(--muted); font-weight: 700; margin-right: 0.15rem; }
    .bubble .md .md-li {
      margin: 0.12rem 0 0.12rem 0.85rem; color: #d5deea; font-size: 0.9rem;
    }
    .bubble.typing { color: var(--muted); font-style: italic; white-space: pre-wrap; }
    .conv-item {
      display: block; width: 100%; text-align: left; margin: 0 0 0.35rem;
      padding: 0.45rem 0.55rem; border-radius: 8px; border: 1px solid var(--border);
      background: var(--panel-2); color: var(--text); cursor: pointer; font-size: 0.85rem;
    }
    .conv-item:hover { border-color: var(--accent); }
    .conv-item .conv-title { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .conv-item .conv-meta { color: var(--muted); font-size: 0.75rem; }
    .composer {
      border-top: 1px solid var(--border); padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem;
      background: var(--panel);
    }
    .composer-row { display: flex; gap: 0.5rem; align-items: flex-end; }
    .composer textarea { flex: 1; min-height: 52px; max-height: 140px; }
    .opts { display: flex; gap: 0.65rem; align-items: center; flex-wrap: wrap; }
    .opts label { font-size: 0.8rem; color: var(--muted); display: flex; gap: 0.3rem; align-items: center; }
    .opts input[type="number"] {
      width: 68px; padding: 0.25rem 0.35rem; border-radius: 6px;
      border: 1px solid var(--border); background: var(--panel-2); color: var(--text);
    }
    .welcome {
      margin: auto; text-align: center; color: var(--muted); max-width: 340px; padding: 1.5rem;
    }
    .welcome strong { color: var(--text); display: block; margin-bottom: 0.4rem; font-size: 1rem; }
    .suggestions { display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: center; margin-top: 0.85rem; }
    .suggestions button {
      font-size: 0.78rem; padding: 0.35rem 0.6rem; border-radius: 999px;
      border: 1px dashed var(--border); background: transparent; color: var(--muted); cursor: pointer;
    }
    .suggestions button:hover { border-style: solid; color: var(--text); border-color: var(--ms); }

    .side-body { flex: 1; overflow: auto; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .card-inner h3 {
      margin: 0 0 0.45rem; font-size: 0.72rem; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--muted);
    }
    .tabs { display: flex; gap: 0.3rem; margin-bottom: 0.45rem; flex-wrap: wrap; }
    .tabs button {
      padding: 0.3rem 0.55rem; font-size: 0.72rem; font-weight: 600;
      background: var(--panel-2); color: var(--muted); border: 1px solid var(--border);
      border-radius: 6px; cursor: pointer;
    }
    .tabs button.active { color: #fff; border-color: var(--accent); background: color-mix(in srgb, var(--accent) 25%, var(--panel-2)); }
    .xray {
      font-family: var(--mono); font-size: 0.72rem; background: #0a0e14; border: 1px solid var(--border);
      border-radius: 8px; padding: 0.65rem; overflow: auto; max-height: 220px;
      white-space: pre-wrap; word-break: break-word; color: #c9d1d9; margin: 0;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .chip {
      font-family: var(--mono); font-size: 0.68rem; background: #0a0e14;
      border: 1px solid var(--border); border-radius: 6px; padding: 0.2rem 0.4rem; color: var(--muted);
    }
    .chip b { color: var(--text); }
    .meta { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .result {
      border: 1px solid var(--border); border-radius: 8px; padding: 0.65rem;
      margin-bottom: 0.5rem; background: var(--panel-2);
    }
    .result .top { display: flex; justify-content: space-between; gap: 0.5rem; align-items: baseline; }
    .result h3 { margin: 0; font-size: 0.92rem; text-transform: none; letter-spacing: 0; color: var(--text); }
    .result .score { color: var(--accent); font-family: var(--mono); font-size: 0.8rem; }
    .scores { display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0.4rem 0; }
    .scores span {
      font-family: var(--mono); font-size: 0.65rem; background: #0a0e14;
      border: 1px solid var(--border); border-radius: 4px; padding: 0.12rem 0.3rem; color: var(--muted);
    }
    .payload { font-size: 0.8rem; color: var(--muted); display: grid; gap: 0.15rem; }
    .payload b { color: var(--text); font-weight: 600; }

    .manual-bar {
      display: flex; flex-direction: column; gap: 0.5rem; background: var(--panel);
      border: 1px solid var(--border); border-radius: 10px; padding: 0.85rem; flex: 1;
    }
    .manual-bar textarea { min-height: 240px; font-family: var(--mono); font-size: 0.78rem; }
    .probe-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
    .card {
      background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 1rem;
    }
    .card h2 {
      margin: 0 0 0.75rem; font-size: 0.75rem; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--muted); font-weight: 700;
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap" style="padding-top:0;padding-bottom:0;flex:none">
      <h1>X-Ray · Chat → <span class="ms">MCP / Microsoft</span></h1>
      <p>Conversa em linguagem natural: o agente esclarece o briefing, decide quando buscar, aplica Query Manager + filtro regional e mostra o X-Ray técnico ao lado.</p>
    </div>
  </header>

  <div class="wrap">
    <div class="auth-row">
      <label class="hint">API key (sk_bf_… ou JWT)</label>
      <input type="password" id="apiKey" placeholder="Cole a chave do cadastro / Bearer" autocomplete="off">
      <button type="button" class="ghost" id="btnUseKey">Usar chave</button>
      <span class="badge" id="authBadge">auth: …</span>
      <span class="hint" id="configHint">Carregando /config…</span>
    </div>

    <div class="mode-tabs">
      <button type="button" class="active" data-mode="chat">1 · Conversa</button>
      <button type="button" data-mode="account">2 · Conta / Auth</button>
      <button type="button" data-mode="manual">3 · Tool call manual</button>
      <button type="button" data-mode="probe">4 · Probes</button>
      <button type="button" data-mode="comms">5 · Fila email</button>
    </div>

    <div id="mode-chat" class="panel-mode active">
      <div class="chat-layout">
        <section class="chat-pane">
          <div class="pane-head">
            <h2>Conversa</h2>
            <div style="display:flex;gap:0.4rem;align-items:center">
              <span class="badge" id="sessionBadge">sessão…</span>
              <button type="button" class="ghost" id="btnNewChat">Nova conversa</button>
            </div>
          </div>
          <div class="thread" id="thread">
            <div class="welcome" id="welcome">
              <strong>Como posso ajudar na busca?</strong>
              Descreva o que precisa — produto, serviço, região, tipo de fornecedor. Posso perguntar o que faltar antes de buscar.
              <div class="suggestions">
                <button type="button" data-suggest="Procuro fabricantes de embalagens plásticas em Campinas com raio de 50 km">Embalagens · Campinas</button>
                <button type="button" data-suggest="Preciso de instalação de energia solar para condomínios em SP">Energia solar · SP</button>
                <button type="button" data-suggest="Quero limpeza industrial, mas ainda não sei a cidade">Limpeza · explorar</button>
              </div>
            </div>
          </div>
          <form class="composer" id="formChat">
            <div class="opts">
              <label>final_limit <input type="number" id="final_limit" min="1" max="100" value="10"></label>
              <label><input type="checkbox" id="forceDebug"> debug</label>
              <label><input type="checkbox" id="forceRerank"> rerank</label>
            </div>
            <div class="composer-row">
              <textarea id="message" rows="2" placeholder="Ex.: preciso de caroço de açaí seco perto de Belém…" required></textarea>
              <button type="submit" class="primary" id="btnSend">Enviar</button>
            </div>
            <p class="hint">O agente usa tools internas (busca, cidades, config). Refine a qualquer momento: “só Fabricante”, “aumenta o raio”, “quero 20”.</p>
          </form>
        </section>

        <aside class="side-pane">
          <div class="pane-head">
            <h2>X-Ray · última busca</h2>
            <div class="meta" id="statusMeta"></div>
          </div>
          <div class="side-body">
            <div class="card-inner">
              <div class="pane-head" style="margin:0;padding:0;border:0">
                <h3 style="margin:0">Minhas conversas</h3>
                <button type="button" class="ghost" id="btnRefreshConversations">Atualizar</button>
              </div>
              <div id="conversationsList" class="hint" style="margin-top:0.5rem;max-height:160px;overflow:auto">Autentique-se para ver o histórico.</div>
            </div>
            <div class="card-inner">
              <h3>Ações do turno</h3>
              <div class="chips" id="actionChips"><span class="hint">Aguardando conversa…</span></div>
            </div>
            <div class="card-inner">
              <h3>Parâmetros</h3>
              <div class="chips" id="paramChips"></div>
            </div>
            <div class="card-inner">
              <div class="tabs" id="xrayTabs">
                <button type="button" class="active" data-tab="tool">mcp_tool_call</button>
                <button type="button" data-tab="qm">query_manager</button>
                <button type="button" data-tab="geo">geo</button>
                <button type="button" data-tab="weights">weights</button>
                <button type="button" data-tab="meta">meta</button>
                <button type="button" data-tab="comms">comms</button>
                <button type="button" data-tab="raw">raw</button>
              </div>
              <pre class="xray" id="xray">Sem busca nesta sessão ainda.</pre>
            </div>
            <div class="card-inner">
              <h3>Resultados <span id="resultsCount" class="badge">0</span></h3>
              <div id="results"><p class="hint">Os fornecedores da última busca aparecem aqui.</p></div>
            </div>
          </div>
        </aside>
      </div>
      <div id="formError" class="error"></div>
    </div>

    <div id="mode-account" class="panel-mode">
      <div class="card" style="flex:1;overflow:auto">
        <h2>Conta comprador + API key (teste Supabase)</h2>
        <p class="hint">Nova conta ou login de conta já existente. A chave <code>sk_bf_…</code> aparece <b>uma vez</b> — cole no campo acima e clique “Usar chave”.</p>
        <div style="display:grid;gap:0.75rem;max-width:520px;margin-top:0.75rem">
          <div>
            <p class="hint" style="margin:0 0 0.35rem"><b>Criar conta</b></p>
            <div style="display:grid;gap:0.5rem">
              <input type="text" id="regNome" placeholder="Nome *">
              <input type="email" id="regEmail" placeholder="Email *">
              <input type="password" id="regPassword" placeholder="Senha (mín. 8) — recomendado p/ login depois">
              <input type="text" id="regTelefone" placeholder="Telefone">
              <input type="text" id="regEmpresa" placeholder="Empresa">
              <button type="button" class="primary" id="btnRegister">Criar conta + chave</button>
            </div>
          </div>
          <div>
            <p class="hint" style="margin:0 0 0.35rem"><b>Já tenho conta</b> (email + senha do Supabase Auth)</p>
            <div style="display:grid;gap:0.5rem">
              <input type="email" id="loginEmail" placeholder="Email *">
              <input type="password" id="loginPassword" placeholder="Senha *">
              <button type="button" class="primary" id="btnLogin">Entrar + emitir chave</button>
            </div>
          </div>
        </div>
        <pre class="xray" id="accountOut" style="margin-top:0.85rem;max-height:280px">Aguardando…</pre>
        <div class="probe-actions" style="margin-top:0.75rem">
          <button type="button" class="ghost" id="btnMe">GET perfil (/auth/me)</button>
          <button type="button" class="ghost" id="btnAuthStatus">Status Supabase</button>
          <button type="button" class="ghost" id="btnNewKey">Emitir nova key</button>
        </div>
        <div class="opts" style="margin-top:0.75rem">
          <label>search_id <input type="text" id="probeSearchId" placeholder="uuid da busca" style="width:260px"></label>
          <button type="button" class="ghost" id="btnConsulta">Ver consulta (async)</button>
          <label>CNPJ <input type="text" id="probeCnpj" placeholder="só dígitos" style="width:140px"></label>
          <button type="button" class="ghost" id="btnAparicoes">Ver aparições</button>
        </div>
        <p class="hint">Após uma busca autenticada, aguarde ~1–2s e consulte o search_id para validar telemetria.</p>
      </div>
    </div>

    <div id="mode-manual" class="panel-mode">
      <div class="manual-bar">
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button type="button" class="ghost" id="btnFillTemplate">Preencher template</button>
          <button type="button" class="ghost" id="btnFromLast">Usar último tool call</button>
          <button type="button" class="primary" id="btnManual">Executar search_text</button>
        </div>
        <textarea id="manualJson" spellcheck="false"></textarea>
        <p class="hint">JSON = arguments da tool MCP search_text.</p>
        <div id="manualError" class="error"></div>
      </div>
    </div>

    <div id="mode-probe" class="panel-mode">
      <div class="card" style="flex:1;overflow:auto">
        <h2>Probes REST / contrato MCP</h2>
        <div class="probe-actions">
          <button type="button" class="ghost" data-probe="health">GET /health</button>
          <button type="button" class="ghost" data-probe="config">GET /config</button>
          <button type="button" class="ghost" data-probe="tools">Contrato tools MCP</button>
          <button type="button" class="ghost" data-probe="cities">GET cities nearby</button>
          <button type="button" class="ghost" data-probe="chatTools">Tools do chat</button>
          <button type="button" class="ghost" data-probe="commsStatus">GET comms status</button>
        </div>
        <pre class="xray" id="probeOut" style="max-height:none">Clique em um probe…</pre>
      </div>
    </div>
    <div id="mode-comms" class="panel-mode">
      <div class="card" style="flex:1;overflow:auto">
        <h2>Fila de e-mail / SMS (recebe-consulta)</h2>
        <p class="hint">Apos busca autenticada: telemetria grava a consulta, depois esta API chama <code>POST /v1/interno/orquestracao/recebe-consulta</code> por fornecedor. O n8n agenda o envio depois.</p>
        <div class="opts" style="margin-top:0.75rem;align-items:end">
          <label>search_id <input type="text" id="commsSearchId" placeholder="uuid da ultima busca" style="width:280px"></label>
          <button type="button" class="primary" id="btnCommsPoll">Ver logs / poll</button>
          <button type="button" class="ghost" id="btnCommsPreview">Preview payloads (dry-run)</button>
          <button type="button" class="ghost" id="btnCommsStatus">Status da fila</button>
        </div>
        <div id="commsBadges" class="chips" style="margin-top:0.75rem"></div>
        <pre class="xray" id="commsOut" style="margin-top:0.75rem;max-height:none">Rode uma busca autenticada e cole o search_id.</pre>
      </div>
    </div>
  </div>

  <script>
    const SESSION_KEY = "xray_chat_session_id";
    const state = {
      config: null,
      last: null,
      tab: "tool",
      mode: "chat",
      sessionId: localStorage.getItem(SESSION_KEY) || null,
      messages: [],
    };
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

    function setMode(mode) {
      state.mode = mode;
      document.querySelectorAll(".mode-tabs button").forEach((b) =>
        b.classList.toggle("active", b.dataset.mode === mode));
      document.querySelectorAll(".panel-mode").forEach((p) =>
        p.classList.toggle("active", p.id === "mode-" + mode));
    }

    function updateSessionBadge() {
      $("sessionBadge").textContent = state.sessionId
        ? ("sessão " + state.sessionId.slice(0, 8) + "…")
        : "nova sessão";
    }

    const WELCOME_HTML =
      '<div class="welcome" id="welcome">' +
        '<strong>Como posso ajudar na busca?</strong>' +
        'Descreva o que precisa — produto, serviço, região, tipo de fornecedor. Posso perguntar o que faltar antes de buscar.' +
        '<div class="suggestions">' +
          '<button type="button" data-suggest="Procuro fabricantes de embalagens plásticas em Campinas com raio de 50 km">Embalagens · Campinas</button>' +
          '<button type="button" data-suggest="Preciso de instalação de energia solar para condomínios em SP">Energia solar · SP</button>' +
          '<button type="button" data-suggest="Quero limpeza industrial, mas ainda não sei a cidade">Limpeza · explorar</button>' +
        '</div></div>';

    function mdToHtml(raw) {
      const text = String(raw ?? "");
      if (!text.trim()) return "";
      let s = esc(text);
      // [label](https://...)  — after esc, brackets/parens remain literal
      s = s.replace(
        /\\[([^\\]]+?)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      );
      s = s.replace(/\\*\\*([^*]+?)\\*\\*/g, "<strong>$1</strong>");
      return s.split("\\n").map((line) => {
        const t = line.trim();
        if (!t) return '<div class="md-gap"></div>';
        if (/^\\d+\\.\\s+/.test(t)) {
          return '<div class="md-item">' + t.replace(/^(\\d+)\\.\\s+/, '<span class="md-n">$1.</span> ') + "</div>";
        }
        if (/^[-*]\\s+/.test(t)) {
          return '<div class="md-li">' + t.replace(/^[-*]\\s+/, "• ") + "</div>";
        }
        return '<div class="md-p">' + line + "</div>";
      }).join("");
    }

    function renderThread() {
      const thread = $("thread");
      const msgs = state.messages || [];
      if (!msgs.length) {
        thread.innerHTML = WELCOME_HTML;
        bindSuggestions();
        return;
      }
      thread.innerHTML = msgs.map((m) => {
        const body = m.role === "assistant"
          ? ('<div class="md">' + mdToHtml(m.content) + "</div>")
          : esc(m.content);
        return (
          '<div class="bubble ' + esc(m.role) + '">' +
            '<span class="who">' + (m.role === "user" ? "Você" : "Agente") + "</span>" +
            body +
          "</div>"
        );
      }).join("");
      thread.scrollTop = thread.scrollHeight;
    }

    function bindSuggestions() {
      document.querySelectorAll("[data-suggest]").forEach((b) => {
        b.addEventListener("click", () => {
          $("message").value = b.dataset.suggest;
          $("message").focus();
        });
      });
    }

    function showTyping() {
      const thread = $("thread");
      const welcome = $("welcome");
      if (welcome) welcome.remove();
      const el = document.createElement("div");
      el.className = "bubble assistant typing";
      el.id = "typing";
      el.innerHTML = '<span class="who">Agente</span>Pensando…';
      thread.appendChild(el);
      thread.scrollTop = thread.scrollHeight;
    }

    function hideTyping() {
      $("typing")?.remove();
    }

    function renderChips(args) {
      if (!args) { $("paramChips").innerHTML = ""; return; }
      const chips = [];
      if (args.weights) for (const [k, v] of Object.entries(args.weights))
        chips.push("<span class='chip'><b>" + esc(k) + "</b> " + Number(v).toFixed(3) + "</span>");
      if (args.bm25_query) chips.push("<span class='chip'><b>bm25</b> " + esc(args.bm25_query) + "</span>");
      if (args.filter) chips.push("<span class='chip'><b>filter</b> " + esc(JSON.stringify(args.filter)) + "</span>");
      if (args.rerank) chips.push("<span class='chip'><b>rerank</b> on</span>");
      $("paramChips").innerHTML = chips.join("") || "<span class='hint'>—</span>";
    }

    function renderActions(actions) {
      if (!actions?.length) {
        $("actionChips").innerHTML = "<span class='hint'>Nenhuma tool neste turno (só conversa)</span>";
        return;
      }
      $("actionChips").innerHTML = actions.map((a) => {
        let extra = "";
        if (a.tool === "search_suppliers")
          extra = " · " + (a.result_count ?? 0) + " results" + (a.intent ? " · " + a.intent : "");
        if (a.tool === "lookup_cities")
          extra = " · " + (a.cities ?? 0) + " cidades";
        return "<span class='chip'><b>" + esc(a.tool) + "</b>" + esc(extra) + "</span>";
      }).join("");
    }

    function renderXray() {
      const d = state.last;
      if (!d || !d.mcp_tool_call) {
        $("xray").textContent = "Sem busca nesta sessão ainda.";
        return;
      }
      const args = d.mcp_tool_call?.arguments || {};
      const map = {
        tool: d.mcp_tool_call,
        qm: d.query_manager || null,
        geo: d.geo || null,
        weights: args.weights || {},
        meta: {
          simulation: d.simulation,
          intent: d.intent,
          model: d.model,
          duration_ms: d.duration_ms,
          search_duration_ms: d.search_duration_ms,
          tokens_used: d.tokens_used,
          actions: d.actions,
          search_id: d.search?.search_id,
        },
        comms: d.comms || { note: "Use aba 5 Fila email" },
        raw: d,
      };
      $("xray").textContent = JSON.stringify(map[state.tab] ?? map.tool, null, 2);
    }

    function renderResults(payload) {
      const results = payload?.results || [];
      $("resultsCount").textContent = String(results.length);
      if (!results.length) {
        $("results").innerHTML = "<p class='hint'>Nenhum resultado nesta busca.</p>";
        return;
      }
      $("results").innerHTML = results.map((r) => {
        const scores = Object.entries(r.scores || {})
          .map(([k, v]) => "<span>" + esc(k) + ": " + Number(v).toFixed(4) + "</span>").join("");
        const p = r.payload || {};
        const uf = (p.uf || "").toString().trim().toUpperCase();
        const cidade = (p.cidade || p.municipio || "").toString().trim();
        const local = uf && cidade ? (uf + " · " + cidade) : (uf || cidade || "—");
        const siteRaw = (p.site || p.website || "").toString().trim();
        const site = siteRaw
          ? (/^https?:\\/\\//i.test(siteRaw) ? siteRaw : ("https://" + siteRaw.replace(/^\\/+/, "")))
          : "";
        const cnpjDigits = String(p.cnpj_basico || p.cnpj || "").replace(/\\D/g, "");
        const basico = cnpjDigits.length >= 14 ? cnpjDigits.slice(0, 8)
          : (cnpjDigits.length >= 8 ? cnpjDigits.slice(0, 8) : cnpjDigits);
        const perfil = basico ? ("https://buscafornecedor.com.br/perfil/" + basico) : "";
        const desc = (p.descricao || "").toString();
        return (
          '<article class="result"><div class="top">' +
            '<h3>' + esc(r.posicao) + ". " + esc(p.nome_empresa || r.id) + '</h3>' +
            '<div class="score">final ' + Number(r.score_final ?? 0).toFixed(4) + '</div></div>' +
            '<div class="scores">' + scores + '</div>' +
            '<div class="payload">' +
              '<div><b>Local</b> ' + esc(local) + '</div>' +
              '<div><b>Modelo de Negócio</b> ' + esc(p.modelo_negocio || "—") + '</div>' +
              '<div><b>Descrição</b> ' + esc(desc.slice(0, 280)) +
              (desc.length > 280 ? "…" : "") + '</div>' +
              (site ? ('<div><b>Site</b> <a href="' + esc(site) + '" target="_blank" rel="noopener">' + esc(site) + '</a></div>') : '') +
              (perfil ? ('<div><b>Perfil</b> <a href="' + esc(perfil) + '" target="_blank" rel="noopener">' + esc(perfil) + '</a></div>') : '') +
            '</div></article>'
        );
      }).join("");
    }

    function showSearchSide(data) {
      if (!data?.mcp_tool_call && !data?.search) return;
      state.last = data;
      renderChips(data.mcp_tool_call?.arguments);
      renderXray();
      if (data.search) renderResults(data.search);
      const sid = data.search?.search_id || data.search_id;
      if (sid) {
        if ($("probeSearchId")) $("probeSearchId").value = sid;
        if ($("commsSearchId")) $("commsSearchId").value = sid;
        pollComms(sid, { auto: true });
      }
      $("statusMeta").innerHTML =
        (data.intent ? '<span class="badge warn">intent ' + esc(data.intent) + '</span>' : '') +
        (data.geo?.cities_in_filter != null
          ? '<span class="badge ok">cidades ' + esc(data.geo.cities_in_filter) + '</span>'
          : '') +
        (data.geo?.scope === "uf" || (data.geo?.uf && !data.geo?.city_name)
          ? '<span class="badge ok">UF ' + esc(Array.isArray(data.geo.uf) ? data.geo.uf.join(",") : data.geo.uf) + '</span>'
          : '') +
        (data.model ? '<span class="badge">' + esc(data.model) + '</span>' : '') +
        (data.duration_ms != null ? '<span class="badge">turn ' + esc(data.duration_ms) + ' ms</span>' : '') +
        (data.search?.search_id
          ? '<span class="badge">id ' + esc(data.search.search_id.slice(0, 8)) + '…</span>'
          : '');
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
        bm25: true,
        bm25_query: "energia solar fotovoltaica",
        limit_per_vector: 50,
        final_limit: 10,
        rerank: false,
        debug: false,
      };
    }

    async function sendChat(e) {
      e.preventDefault();
      $("formError").textContent = "";
      const message = $("message").value.trim();
      if (!message) return;

      const btn = $("btnSend");
      btn.disabled = true;
      $("message").value = "";

      // Optimistic user bubble
      state.messages = [...(state.messages || []), { role: "user", content: message }];
      renderThread();
      showTyping();

      try {
        const res = await fetch("/search/xray/chat", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            session_id: state.sessionId,
            message,
            final_limit: Number($("final_limit").value) || 10,
            debug: $("forceDebug").checked,
            rerank: $("forceRerank").checked,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));

        state.sessionId = data.session_id;
        localStorage.setItem(SESSION_KEY, data.session_id);
        updateSessionBadge();
        state.messages = data.messages || [];
        hideTyping();
        renderThread();
        renderActions(data.actions);
        if (data.issued_api_key) {
          $("apiKey").value = data.issued_api_key;
          localStorage.setItem("xray_api_key", data.issued_api_key);
          refreshAuthStatus().catch(() => {});
        } else if ($("apiKey").value.trim()) {
          loadConversationsList().catch(() => {});
        }
        if (data.search || data.mcp_tool_call) showSearchSide(data);
      } catch (err) {
        hideTyping();
        state.messages = state.messages.slice(0, -1);
        renderThread();
        $("formError").textContent = err.message || String(err);
        $("message").value = message;
      } finally {
        btn.disabled = false;
        $("message").focus();
      }
    }

    async function newChat() {
      $("formError").textContent = "";
      try {
        const res = await fetch("/search/xray/chat/reset", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ session_id: state.sessionId }),
        });
        const data = await res.json();
        state.sessionId = data.session_id;
        localStorage.setItem(SESSION_KEY, data.session_id);
        state.messages = [];
        state.last = null;
        updateSessionBadge();
        renderThread();
        renderActions([]);
        $("paramChips").innerHTML = "";
        $("xray").textContent = "Sem busca nesta sessão ainda.";
        $("results").innerHTML = "<p class='hint'>Os fornecedores da última busca aparecem aqui.</p>";
        $("resultsCount").textContent = "0";
        $("statusMeta").innerHTML = "";
        $("message").focus();
      } catch (err) {
        $("formError").textContent = err.message || String(err);
      }
    }

    async function runManual() {
      $("manualError").textContent = "";
      let args;
      try { args = JSON.parse($("manualJson").value); }
      catch { $("manualError").textContent = "JSON inválido"; return; }
      $("btnManual").disabled = true;
      try {
        const res = await fetch("/search/xray/tool", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ arguments: args }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
        showSearchSide({
          ...data,
          reasoning: "Tool call manual",
          actions: [{ tool: "search_text (manual)" }],
        });
        renderActions([{ tool: "search_text (manual)", result_count: data.search?.results?.length }]);
        setMode("chat");
      } catch (err) {
        $("manualError").textContent = err.message || String(err);
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
        if (kind === "cities") {
          const qs = new URLSearchParams({
            city_name: "Campinas",
            uf: "SP",
            radius_km: "50",
          });
          const res = await fetch("/search/xray/cities/nearby?" + qs.toString(), {
            headers: authHeaders(),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
          $("probeOut").textContent = JSON.stringify({
            total_found: data.total_found,
            cities_in_filter: data.city_names?.length,
            city_names: data.city_names,
            center_city: data.center_city,
          }, null, 2);
          return;
        }
        if (kind === "commsStatus") {
          const res = await fetch("/search/xray/comms/status", { headers: authHeaders() });
          $("probeOut").textContent = JSON.stringify(await res.json(), null, 2);
          return;
        }
        if (kind === "chatTools") {
          $("probeOut").textContent = JSON.stringify({
            endpoint: "POST /search/xray/chat",
            tools: [
              "get_search_config",
              "get_my_profile",
              "register_buyer",
              "login_buyer",
              "lookup_cities",
              "search_suppliers → Query Manager → filter.cidade list → search_text",
            ],
            auth: "POST /search/xray/auth/register · POST /search/xray/auth/login · GET /search/xray/auth/me",
            reset: "POST /search/xray/chat/reset",
          }, null, 2);
          return;
        }
        if (kind === "tools") {
          const cfg = state.config || (await loadConfig(), state.config);
          $("probeOut").textContent = JSON.stringify({
            mcp_endpoint: cfg?.mcp?.endpoint || "/mcp",
            tools: [
              { name: "get_config", mirrors: "GET /config" },
              { name: "search_text", mirrors: "POST /search/text" },
            ],
            auth: cfg?.auth,
          }, null, 2);
        }
      } catch (err) {
        $("formError").textContent = err.message || String(err);
        $("probeOut").textContent = String(err);
      }
    }

    document.querySelectorAll(".mode-tabs button").forEach((b) =>
      b.addEventListener("click", () => setMode(b.dataset.mode)));
    document.querySelectorAll("#xrayTabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tab = btn.dataset.tab;
        document.querySelectorAll("#xrayTabs button").forEach((b) =>
          b.classList.toggle("active", b === btn));
        renderXray();
      });
    });
    document.querySelectorAll("[data-probe]").forEach((b) =>
      b.addEventListener("click", () => runProbe(b.dataset.probe)));
    $("formChat").addEventListener("submit", sendChat);
    $("btnNewChat").addEventListener("click", newChat);
    if ($("btnRefreshConversations")) {
      $("btnRefreshConversations").addEventListener("click", () => loadConversationsList());
    }
    $("btnManual").addEventListener("click", runManual);
    $("btnFillTemplate").addEventListener("click", () => {
      $("manualJson").value = JSON.stringify(templateArgs(), null, 2);
    });
    $("btnFromLast").addEventListener("click", () => {
      const args = state.last?.mcp_tool_call?.arguments;
      if (!args) { $("manualError").textContent = "Nenhum tool call ainda"; return; }
      $("manualJson").value = JSON.stringify(args, null, 2);
      setMode("manual");
    });
    $("message").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        $("formChat").requestSubmit();
      }
    });

    async function refreshAuthStatus() {
      try {
        const res = await fetch("/search/xray/auth/status", { headers: authHeaders() });
        const data = await res.json();
        const a = data.auth || {};
        const modes = (data.auth_modes_env || data.config_auth?.modes || []).join(",") || (data.config_auth?.mode || "?");
        const sess = a.authenticated
          ? ((a.provider || "?") + (a.comprador ? " · comprador" : ""))
          : "sessão anônima";
        const mig = data.api_keys_table?.ok === false ? " · api_keys FALTA" : "";
        $("authBadge").textContent = "mode:" + modes + " · " + sess + " · supabase " + (data.supabase_configured ? "ok" : "off") + mig;
        $("authBadge").className = "badge " + (a.authenticated ? "ok" : (data.api_keys_table?.ok === false ? "err" : "warn"));
        if (a.authenticated) loadConversationsList().catch(() => {});
        else {
          $("conversationsList").textContent = "Autentique-se para ver o histórico.";
          $("conversationsList").className = "hint";
        }
        return data;
      } catch (e) {
        $("authBadge").textContent = "auth: erro";
        $("authBadge").className = "badge err";
      }
    }

    async function loadConversationsList() {
      const el = $("conversationsList");
      if (!$("apiKey").value.trim()) {
        el.textContent = "Autentique-se para ver o histórico.";
        el.className = "hint";
        return;
      }
      el.textContent = "Carregando…";
      el.className = "hint";
      try {
        const res = await fetch("/search/xray/conversations?limit=20", { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
        const items = data.items || [];
        if (!items.length) {
          el.textContent = "Nenhuma conversa salva ainda.";
          el.className = "hint";
          return;
        }
        el.className = "";
        el.innerHTML = items.map((c) => {
          const title = esc(c.title || "(sem título)");
          const when = c.updated_at ? new Date(c.updated_at).toLocaleString("pt-BR") : "";
          return (
            '<button type="button" class="conv-item" data-conv-id="' + esc(c.id) + '">' +
              '<span class="conv-title">' + title + '</span>' +
              '<span class="conv-meta">' + esc(when) + (c.key_prefix ? " · " + esc(c.key_prefix) : "") + '</span>' +
            '</button>'
          );
        }).join("");
        el.querySelectorAll("[data-conv-id]").forEach((btn) => {
          btn.addEventListener("click", () => openConversation(btn.getAttribute("data-conv-id")));
        });
      } catch (e) {
        el.textContent = e.message || String(e);
        el.className = "hint";
      }
    }

    async function openConversation(id) {
      if (!id) return;
      $("formError").textContent = "";
      try {
        const res = await fetch("/search/xray/conversations/" + encodeURIComponent(id), {
          headers: authHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
        state.sessionId = data.id;
        localStorage.setItem(SESSION_KEY, data.id);
        updateSessionBadge();
        state.messages = (data.messages || [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content || "" }));
        renderThread();
        const toolMsg = (data.messages || []).slice().reverse().find((m) => m.role === "tool" && m.metadata?.search_id);
        if (toolMsg?.metadata) {
          showSearchSide({
            search: {
              search_id: toolMsg.metadata.search_id,
              results: toolMsg.metadata.results || [],
              fallback: toolMsg.metadata.fallback,
            },
            actions: [{ tool: toolMsg.metadata.tool || "search_suppliers", result_count: toolMsg.metadata.result_count }],
          });
        }
        setMode("chat");
        $("message").focus();
      } catch (e) {
        $("formError").textContent = e.message || String(e);
      }
    }

    $("btnUseKey").addEventListener("click", async () => {
      localStorage.setItem("xray_api_key", $("apiKey").value.trim());
      await refreshAuthStatus();
      try {
        const res = await fetch("/search/xray/auth/me", { headers: authHeaders() });
        $("accountOut").textContent = JSON.stringify(await res.json(), null, 2);
      } catch (e) {
        $("accountOut").textContent = String(e);
      }
    });

    $("btnRegister").addEventListener("click", async () => {
      $("accountOut").textContent = "Registrando…";
      try {
        const body = {
          nome: $("regNome").value.trim(),
          email: $("regEmail").value.trim(),
          telefone: $("regTelefone").value.trim() || undefined,
          empresa_nome: $("regEmpresa").value.trim() || undefined,
        };
        const pw = $("regPassword").value;
        if (pw) body.password = pw;
        const res = await fetch("/search/xray/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
        if (data.api_key?.key) {
          $("apiKey").value = data.api_key.key;
          localStorage.setItem("xray_api_key", data.api_key.key);
        }
        $("accountOut").textContent = JSON.stringify(data, null, 2);
        await refreshAuthStatus();
      } catch (e) {
        $("accountOut").textContent = e.message || String(e);
      }
    });

    $("btnLogin").addEventListener("click", async () => {
      $("accountOut").textContent = "Entrando…";
      try {
        const res = await fetch("/search/xray/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: $("loginEmail").value.trim(),
            password: $("loginPassword").value,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
        if (data.api_key?.key) {
          $("apiKey").value = data.api_key.key;
          localStorage.setItem("xray_api_key", data.api_key.key);
        }
        $("accountOut").textContent = JSON.stringify(data, null, 2);
        await refreshAuthStatus();
      } catch (e) {
        $("accountOut").textContent = e.message || String(e);
      }
    });

    $("btnMe").addEventListener("click", async () => {
      const res = await fetch("/search/xray/auth/me", { headers: authHeaders() });
      $("accountOut").textContent = JSON.stringify(await res.json(), null, 2);
    });
    $("btnAuthStatus").addEventListener("click", async () => {
      $("accountOut").textContent = JSON.stringify(await refreshAuthStatus(), null, 2);
    });
    $("btnNewKey").addEventListener("click", async () => {
      if (!$("apiKey").value.trim()) {
        $("accountOut").textContent =
          "Emitir nova key exige estar autenticado. Use “Criar conta + chave” ou “Entrar + emitir chave” primeiro; depois cole a key e use este botão para rotacionar.";
        return;
      }
      const res = await fetch("/search/xray/auth/api-keys", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: "xray-" + Date.now() }),
      });
      const data = await res.json();
      if (!res.ok) {
        $("accountOut").textContent = JSON.stringify(data, null, 2);
        return;
      }
      if (data.key) {
        $("apiKey").value = data.key;
        localStorage.setItem("xray_api_key", data.key);
      }
      $("accountOut").textContent = JSON.stringify(data, null, 2);
    });
    
    function renderCommsBadges(summary, status) {
      const parts = [];
      if (status) {
        parts.push('<span class="badge ' + (status.configured ? "ok" : "err") + '">notif ' +
          (status.configured ? "key ok" : "sem NOTIFICACAO_API_KEY") + '</span>');
        parts.push('<span class="badge">mode ' + esc(status.mode) + '</span>');
        if (status.queue_depth != null) parts.push('<span class="badge">queue ' + esc(status.queue_depth) + '</span>');
      }
      if (summary) {
        const fin = summary.finished === true ? "ok" : (summary.finished === false ? "warn" : "");
        parts.push('<span class="badge ' + fin + '">expected ' + esc(summary.expected ?? "-") + '</span>');
        parts.push('<span class="badge ok">ok ' + esc(summary.ok) + '</span>');
        parts.push('<span class="badge ' + (summary.error ? "err" : "") + '">err ' + esc(summary.error) + '</span>');
        parts.push('<span class="badge">already ' + esc(summary.already) + '</span>');
        if (summary.finished === true) parts.push('<span class="badge ok">fluxo concluido</span>');
        if (summary.finished === false) parts.push('<span class="badge warn">aguardando</span>');
      }
      if ($("commsBadges")) $("commsBadges").innerHTML = parts.join("");
    }

    async function fetchCommsStatus() {
      const res = await fetch("/search/xray/comms/status", { headers: authHeaders() });
      return res.json();
    }

    async function fetchCommsLogs(searchId) {
      const q = searchId ? ("?search_id=" + encodeURIComponent(searchId)) : "";
      const res = await fetch("/search/xray/comms/logs" + q, { headers: authHeaders() });
      return res.json();
    }

    let commsPollTimer = null;
    async function pollComms(searchId, opts) {
      opts = opts || {};
      const auto = opts.auto === true;
      const rounds = opts.rounds != null ? opts.rounds : 8;
      const id = (searchId || ($("commsSearchId") && $("commsSearchId").value.trim()) || "").trim();
      if (!id) {
        if ($("commsOut")) $("commsOut").textContent = "Informe search_id";
        return;
      }
      if ($("commsSearchId")) $("commsSearchId").value = id;
      if (commsPollTimer) { clearInterval(commsPollTimer); commsPollTimer = null; }
      let left = rounds;
      const tick = async function() {
        try {
          const pair = await Promise.all([fetchCommsStatus(), fetchCommsLogs(id)]);
          const status = pair[0];
          const logsPayload = pair[1];
          const summary = logsPayload.summary || null;
          renderCommsBadges(summary, status);
          if ($("commsOut")) {
            $("commsOut").textContent = JSON.stringify({
              polled_at: new Date().toISOString(), auto: auto,
              status: { mode: status.mode, configured: status.configured, base_url: status.base_url, queue_depth: status.queue_depth },
              summary: summary, logs: logsPayload.logs
            }, null, 2);
          }
          if (state.last) state.last.comms = { summary: summary, logs: logsPayload.logs };
          if (state.tab === "comms") renderXray();
          left -= 1;
          if ((summary && summary.finished) || left <= 0) {
            if (commsPollTimer) { clearInterval(commsPollTimer); commsPollTimer = null; }
          }
        } catch (e) {
          if ($("commsOut")) $("commsOut").textContent = String(e);
          if (commsPollTimer) { clearInterval(commsPollTimer); commsPollTimer = null; }
        }
      };
      await tick();
      if (left > 0) commsPollTimer = setInterval(tick, 1200);
    }

    async function previewComms() {
      const id = ($("commsSearchId") && $("commsSearchId").value.trim()) || "";
      if (!id) { $("commsOut").textContent = "Informe search_id"; return; }
      $("commsOut").textContent = "Montando preview...";
      const res = await fetch("/search/xray/comms/preview", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ search_id: id }),
      });
      const data = await res.json();
      $("commsOut").textContent = JSON.stringify(data, null, 2);
      if (data.live_comms) {
        renderCommsBadges(data.live_comms, data.notificacao ? { configured: data.notificacao.configured, mode: data.notificacao.mode, queue_depth: null } : null);
      }
    }

    $("btnConsulta").addEventListener("click", async () => {
      const id = $("probeSearchId").value.trim();
      if (!id) { $("accountOut").textContent = "Informe search_id"; return; }
      const res = await fetch("/search/xray/telemetry/consulta/" + encodeURIComponent(id), {
        headers: authHeaders(),
      });
      $("accountOut").textContent = JSON.stringify(await res.json(), null, 2);
    });
    $("btnAparicoes").addEventListener("click", async () => {
      const cnpj = $("probeCnpj").value.trim();
      if (!cnpj) { $("accountOut").textContent = "Informe CNPJ"; return; }
      const res = await fetch("/search/xray/telemetry/aparicoes/" + encodeURIComponent(cnpj), {
        headers: authHeaders(),
      });

    if ($("btnCommsPoll")) $("btnCommsPoll").addEventListener("click", function() { pollComms(null, { auto: false, rounds: 10 }); });
    if ($("btnCommsPreview")) $("btnCommsPreview").addEventListener("click", function() { previewComms(); });
    if ($("btnCommsStatus")) $("btnCommsStatus").addEventListener("click", async function() {
      const status = await fetchCommsStatus();
      renderCommsBadges(null, status);
      $("commsOut").textContent = JSON.stringify(status, null, 2);
    });
      $("accountOut").textContent = JSON.stringify(await res.json(), null, 2);
    });

    const savedKey = localStorage.getItem("xray_api_key");
    if (savedKey) $("apiKey").value = savedKey;

    $("apiKey").addEventListener("change", () => {
      localStorage.setItem("xray_api_key", $("apiKey").value.trim());
      loadConfig().catch(() => {});
      refreshAuthStatus();
    });

    updateSessionBadge();
    bindSuggestions();
    loadConfig()
      .then(() => {
        $("manualJson").value = JSON.stringify(templateArgs(), null, 2);
        return refreshAuthStatus();
      })
      .catch((err) => {
        $("configHint").textContent = "Erro: " + err.message;
        $("formError").textContent = err.message;
      });
  </script>
</body>
</html>`;
}
