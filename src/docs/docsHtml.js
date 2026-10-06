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
      --navy: #0f2e4c; --navy-deep: #0a1f33; --green: #00c290;
      --bg: #f5f8fa; --panel: #ffffff; --text: #1b3550; --heading: #0f2e4c; --muted: #5b7088; --border: #dde6ee;
      --accent: #00775a; --accent-strong: #006248; --accent-soft: #e6f9f3;
      --code-bg: #0a1f33; --code-text: #e3edf6; --inline-bg: #eaf1f7; --inline-text: #0f2e4c;
      --th-bg: #edf3f8; --row-alt: #fafcfd;
      --header-bg: var(--navy); --header-h: 60px; --sidebar: 290px;
      --sans: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
      --mono: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b1a2a; --panel: #0f2438; --text: #dbe6f0; --heading: #f1f6fa; --muted: #98aec4; --border: #1f3a55;
        --accent: #3ddbb0; --accent-strong: #6be6c4; --accent-soft: rgba(0, 194, 144, 0.14);
        --code-bg: #06121f; --code-text: #e3edf6; --inline-bg: #16304a; --inline-text: #e3edf6;
        --th-bg: #132c45; --row-alt: #0d2134; --header-bg: #0a1f33; --bar-start: #2e6b95;
      }
    }
    * { box-sizing: border-box; }
    html { scroll-padding-top: calc(var(--header-h) + 18px); }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); line-height: 1.6; }
    ::selection { background: rgba(0, 194, 144, 0.28); }
    header.top {
      position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 1.25rem;
      min-height: var(--header-h); padding: 0.6rem 1.5rem; background: var(--header-bg); color: #fff;
      border-bottom: 3px solid transparent;
      border-image: linear-gradient(90deg, var(--navy), var(--green)) 1;
    }
    header.top .brand { font-weight: 700; white-space: nowrap; letter-spacing: 0.01em; }
    header.top .brand span { color: var(--green); }
    nav.tabs { display: flex; gap: 0.3rem; flex-wrap: wrap; }
    nav.tabs .tab {
      padding: 0.35rem 0.85rem; border-radius: 999px; color: rgba(255, 255, 255, 0.78); text-decoration: none; font-weight: 600; font-size: 0.92rem;
    }
    nav.tabs .tab:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }
    nav.tabs .tab.active { color: var(--navy); background: var(--green); }
    header.top .links { margin-left: auto; display: flex; gap: 0.9rem; font-size: 0.88rem; }
    header.top .links a { color: rgba(255, 255, 255, 0.72); text-decoration: none; }
    header.top .links a:hover { color: var(--green); }
    .layout { display: grid; grid-template-columns: var(--sidebar) minmax(0, 1fr); max-width: 1320px; margin: 0 auto; }
    aside.sidebar {
      position: sticky; top: var(--header-h); align-self: start; height: calc(100vh - var(--header-h)); overflow-y: auto;
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
    aside .toc a:hover { color: var(--heading); background: var(--inline-bg); }
    aside .toc a.active { color: var(--accent-strong); background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--green); font-weight: 600; }
    aside .toc a.toc-l3 { padding-left: 1.25rem; font-size: 0.83rem; }
    aside input:focus { outline: none; border-color: var(--green); box-shadow: 0 0 0 3px rgba(0, 194, 144, 0.2); }
    main { padding: 2rem 3rem 5rem; min-width: 0; }
    article { max-width: 900px; }
    article h1, article h2, article h3, article h4 { color: var(--heading); position: relative; }
    article h1 { font-size: 2rem; line-height: 1.25; margin: 0 0 1rem; }
    article h1::after {
      content: ""; display: block; width: 64px; height: 4px; margin-top: 0.6rem; border-radius: 4px;
      background: linear-gradient(90deg, var(--bar-start, var(--navy)), var(--green));
    }
    article h2 { font-size: 1.45rem; margin: 2.6rem 0 0.9rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--border); }
    article h2::after { content: ""; position: absolute; left: 0; bottom: -1px; width: 48px; height: 2px; background: var(--green); }
    article h3 { font-size: 1.15rem; margin: 2rem 0 0.6rem; }
    article h4 { font-size: 1rem; margin: 1.5rem 0 0.5rem; }
    .anchor { position: absolute; left: -1.1em; color: var(--muted); text-decoration: none; opacity: 0; font-weight: 400; }
    .anchor:hover { color: var(--accent); }
    h1:hover .anchor, h2:hover .anchor, h3:hover .anchor, h4:hover .anchor { opacity: 1; }
    article a { color: var(--accent); text-underline-offset: 2px; }
    article a:hover { color: var(--accent-strong); }
    article p, article li { font-size: 0.98rem; }
    article strong { color: var(--heading); }
    article code {
      font-family: var(--mono); font-size: 0.86em; background: var(--inline-bg); color: var(--inline-text);
      padding: 0.12em 0.38em; border-radius: 5px;
    }
    article pre {
      position: relative; background: var(--code-bg); color: var(--code-text); padding: 1rem 1.1rem; border-radius: 10px;
      overflow-x: auto; font-size: 0.84rem; line-height: 1.5; border-left: 3px solid var(--green);
    }
    article pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
    .copy {
      position: absolute; top: 0.5rem; right: 0.5rem; padding: 0.2rem 0.6rem; font-size: 0.75rem; border-radius: 6px;
      border: 1px solid rgba(0, 194, 144, 0.45); background: #12304d; color: #d6f5ec; cursor: pointer; opacity: 0; transition: opacity 0.15s;
    }
    .copy:hover { background: var(--green); color: var(--navy); }
    article pre:hover .copy { opacity: 1; }
    .table-wrap { overflow-x: auto; margin: 1rem 0; border: 1px solid var(--border); border-radius: 10px; }
    article table { border-collapse: collapse; width: 100%; font-size: 0.9rem; background: var(--panel); }
    article th, article td { border-bottom: 1px solid var(--border); padding: 0.55rem 0.75rem; text-align: left; vertical-align: top; }
    article th + th, article td + td { border-left: 1px solid var(--border); }
    article tbody tr:last-child td { border-bottom: none; }
    article tbody tr:nth-child(even) td { background: var(--row-alt); }
    article th { background: var(--th-bg); color: var(--heading); font-weight: 650; }
    article blockquote {
      margin: 1rem 0; padding: 0.7rem 1rem; border-left: 4px solid var(--green); background: var(--accent-soft);
      border-radius: 0 8px 8px 0; color: var(--text);
    }
    article blockquote p { margin: 0.2rem 0; }
    article hr { border: none; border-top: 1px solid var(--border); margin: 2.2rem 0; }
    .dead-link { border-bottom: 1px dotted var(--muted); }
    .raw { display: inline-block; margin-top: 2.5rem; font-size: 0.85rem; color: var(--accent); }
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
