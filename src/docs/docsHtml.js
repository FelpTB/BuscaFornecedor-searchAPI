import { DOCS } from "./renderDocs.js";

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Página HTML da documentação: abas por documento, índice lateral (h2/h3) e conteúdo renderizado.
 */
export function getDocsHtml({ doc, html, toc }) {
  const tabs = DOCS.map(
    (d) => `<a class="tab${d.slug === doc.slug ? " active" : ""}" href="/docs/${d.slug}">${escapeHtml(d.title)}</a>`,
  ).join("");
  const tocHtml = toc
    .map((t) => `<a class="toc-l${t.depth}" href="#${escapeHtml(t.id)}">${escapeHtml(t.text)}</a>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(doc.title)} · Documentação BuscaFornecedor API</title>
  <style>
    :root {
      --bg: #f7f8fb; --panel: #ffffff; --text: #1d2433; --muted: #5d6779; --border: #e2e6ee;
      --accent: #2f6fed; --accent-soft: #e8f0ff; --code-bg: #0f172a; --code-text: #e2e8f0;
      --inline-bg: #eef1f6; --sidebar: 290px;
      --sans: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
      --mono: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0d1117; --panel: #131a24; --text: #e6edf3; --muted: #9aa6b8; --border: #253041;
        --accent: #6ea8ff; --accent-soft: #16233a; --code-bg: #0a0f17; --inline-bg: #1c2532;
      }
    }
    * { box-sizing: border-box; }
    html { scroll-padding-top: 76px; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); line-height: 1.6; }
    header.top {
      position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 1.25rem;
      padding: 0.7rem 1.5rem; background: var(--panel); border-bottom: 1px solid var(--border);
    }
    header.top .brand { font-weight: 700; white-space: nowrap; }
    header.top .brand span { color: var(--accent); }
    nav.tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; }
    nav.tabs .tab {
      padding: 0.35rem 0.8rem; border-radius: 999px; color: var(--muted); text-decoration: none; font-weight: 600; font-size: 0.92rem;
    }
    nav.tabs .tab:hover { color: var(--text); background: var(--inline-bg); }
    nav.tabs .tab.active { color: var(--accent); background: var(--accent-soft); }
    header.top .links { margin-left: auto; display: flex; gap: 0.9rem; font-size: 0.88rem; }
    header.top .links a { color: var(--muted); text-decoration: none; }
    header.top .links a:hover { color: var(--accent); }
    .layout { display: grid; grid-template-columns: var(--sidebar) minmax(0, 1fr); max-width: 1320px; margin: 0 auto; }
    aside.sidebar {
      position: sticky; top: 57px; align-self: start; height: calc(100vh - 57px); overflow-y: auto;
      padding: 1.25rem 1rem 2rem 1.5rem; border-right: 1px solid var(--border);
    }
    aside .doc-sub { font-size: 0.85rem; color: var(--muted); margin: 0 0 0.85rem; }
    aside input {
      width: 100%; padding: 0.45rem 0.65rem; margin-bottom: 0.75rem; border-radius: 8px;
      border: 1px solid var(--border); background: var(--panel); color: var(--text); font-size: 0.88rem;
    }
    aside .toc a {
      display: block; padding: 0.22rem 0.5rem; border-radius: 6px; color: var(--muted);
      text-decoration: none; font-size: 0.88rem; line-height: 1.35;
    }
    aside .toc a:hover { color: var(--text); background: var(--inline-bg); }
    aside .toc a.active { color: var(--accent); background: var(--accent-soft); }
    aside .toc a.toc-l3 { padding-left: 1.25rem; font-size: 0.83rem; }
    main { padding: 2rem 3rem 5rem; min-width: 0; }
    article { max-width: 900px; }
    article h1 { font-size: 2rem; line-height: 1.25; margin: 0 0 1rem; }
    article h2 { font-size: 1.45rem; margin: 2.6rem 0 0.9rem; padding-bottom: 0.35rem; border-bottom: 1px solid var(--border); }
    article h3 { font-size: 1.15rem; margin: 2rem 0 0.6rem; }
    article h4 { font-size: 1rem; margin: 1.5rem 0 0.5rem; }
    article h1, article h2, article h3, article h4 { position: relative; }
    .anchor { position: absolute; left: -1.1em; color: var(--muted); text-decoration: none; opacity: 0; font-weight: 400; }
    h1:hover .anchor, h2:hover .anchor, h3:hover .anchor, h4:hover .anchor { opacity: 1; }
    article a { color: var(--accent); }
    article p, article li { font-size: 0.98rem; }
    article code {
      font-family: var(--mono); font-size: 0.86em; background: var(--inline-bg); padding: 0.12em 0.38em; border-radius: 5px;
    }
    article pre {
      position: relative; background: var(--code-bg); color: var(--code-text); padding: 1rem 1.1rem; border-radius: 10px;
      overflow-x: auto; font-size: 0.84rem; line-height: 1.5;
    }
    article pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
    .copy {
      position: absolute; top: 0.5rem; right: 0.5rem; padding: 0.2rem 0.55rem; font-size: 0.75rem; border-radius: 6px;
      border: 1px solid #334155; background: #1e293b; color: #cbd5e1; cursor: pointer; opacity: 0; transition: opacity 0.15s;
    }
    article pre:hover .copy { opacity: 1; }
    .table-wrap { overflow-x: auto; margin: 1rem 0; }
    article table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
    article th, article td { border: 1px solid var(--border); padding: 0.5rem 0.7rem; text-align: left; vertical-align: top; }
    article th { background: var(--inline-bg); font-weight: 650; }
    article blockquote {
      margin: 1rem 0; padding: 0.7rem 1rem; border-left: 4px solid var(--accent); background: var(--accent-soft); border-radius: 0 8px 8px 0;
    }
    article blockquote p { margin: 0.2rem 0; }
    article hr { border: none; border-top: 1px solid var(--border); margin: 2.2rem 0; }
    .dead-link { border-bottom: 1px dotted var(--muted); }
    .raw { display: inline-block; margin-top: 2.5rem; font-size: 0.85rem; color: var(--muted); }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      aside.sidebar { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--border); }
      main { padding: 1.5rem 1.1rem 4rem; }
      header.top { flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <header class="top">
    <div class="brand">BuscaFornecedor <span>API</span> · Docs</div>
    <nav class="tabs">${tabs}</nav>
    <div class="links">
      <a href="/config" target="_blank" rel="noopener">GET /config</a>
      <a href="/health" target="_blank" rel="noopener">GET /health</a>
      <a href="/search/xray" target="_blank" rel="noopener">X-Ray</a>
    </div>
  </header>
  <div class="layout">
    <aside class="sidebar">
      <p class="doc-sub">${escapeHtml(doc.subtitle)}</p>
      <input type="search" id="tocFilter" placeholder="Filtrar seções…" aria-label="Filtrar seções">
      <nav class="toc" id="toc">${tocHtml}</nav>
    </aside>
    <main>
      <article id="content">${html}</article>
      <a class="raw" href="/docs/${doc.slug}.md">Ver markdown original</a>
    </main>
  </div>
  <script>
    document.querySelectorAll("article pre").forEach(function (pre) {
      var btn = document.createElement("button");
      btn.className = "copy";
      btn.type = "button";
      btn.textContent = "Copiar";
      btn.addEventListener("click", function () {
        var code = pre.querySelector("code");
        navigator.clipboard.writeText(code ? code.innerText : pre.innerText).then(function () {
          btn.textContent = "Copiado";
          setTimeout(function () { btn.textContent = "Copiar"; }, 1200);
        });
      });
      pre.appendChild(btn);
    });

    var filter = document.getElementById("tocFilter");
    var links = Array.prototype.slice.call(document.querySelectorAll("#toc a"));
    var fold = function (s) { return s.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase(); };
    filter.addEventListener("input", function () {
      var q = fold(filter.value.trim());
      links.forEach(function (a) { a.style.display = !q || fold(a.textContent).indexOf(q) >= 0 ? "" : "none"; });
    });

    var byId = {};
    links.forEach(function (a) { byId[decodeURIComponent(a.getAttribute("href").slice(1))] = a; });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove("active"); });
        var link = byId[e.target.id];
        if (link) {
          link.classList.add("active");
          link.scrollIntoView({ block: "nearest" });
        }
      });
    }, { rootMargin: "-70px 0px -75% 0px" });
    document.querySelectorAll("article h2[id], article h3[id]").forEach(function (h) { observer.observe(h); });
  </script>
</body>
</html>`;
}
