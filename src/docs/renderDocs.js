import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, Renderer } from "marked";

const DOCS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/api");

/** Ordem = ordem das abas na página /docs. */
export const DOCS = [
  { slug: "guia", file: "GUIA.md", title: "Guia de uso", subtitle: "Comece aqui: conceitos, primeiros passos e boas práticas" },
  { slug: "endpoints", file: "ENDPOINTS.md", title: "Endpoints", subtitle: "Cada rota com funcionamento, entrada, saída e erros" },
  { slug: "referencia", file: "REFERENCE.md", title: "Referência", subtitle: "Auth, convenções, erros, limites, MCP e integração" },
];

const FILE_TO_SLUG = Object.fromEntries(DOCS.map((d) => [d.file.toLowerCase(), d.slug]));

export function findDoc(slug) {
  return DOCS.find((d) => d.slug === slug) || null;
}

/** Slug no padrão GitHub, para que links #ancora funcionem no repo e na página. */
function githubSlug(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function rewriteHref(href) {
  if (!href) return null;
  if (/^(https?:|mailto:|#)/i.test(href)) return href;
  const [file, hash] = href.split("#");
  const slug = FILE_TO_SLUG[path.basename(file).toLowerCase()];
  if (slug) return `/docs/${slug}${hash ? `#${hash}` : ""}`;
  return null;
}

function renderMarkdown(source) {
  const toc = [];
  const seen = new Map();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        const base = githubSlug(text.replace(/`/g, ""));
        const n = seen.get(base) || 0;
        seen.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        const inner = this.parser.parseInline(tokens);
        if (depth === 2 || depth === 3) toc.push({ id, depth, text: text.replace(/`/g, "") });
        return `<h${depth} id="${escapeHtml(id)}"><a class="anchor" href="#${escapeHtml(id)}" aria-hidden="true">#</a>${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const target = rewriteHref(href);
        if (!target) return `<span class="dead-link" title="${escapeHtml(href)}">${inner}</span>`;
        const external = /^https?:/i.test(target);
        return `<a href="${escapeHtml(target)}"${title ? ` title="${escapeHtml(title)}"` : ""}${external ? ' target="_blank" rel="noopener"' : ""}>${inner}</a>`;
      },
      table(token) {
        const html = Renderer.prototype.table.call(this, token);
        return `<div class="table-wrap">${html}</div>`;
      },
    },
  });
  const html = marked.parse(source);
  return { html, toc };
}

const cache = new Map();

/** Renderiza o markdown do doc (cache invalidado pelo mtime do arquivo). */
export function getRenderedDoc(doc) {
  const file = path.join(DOCS_DIR, doc.file);
  const stat = fs.statSync(file);
  const hit = cache.get(doc.slug);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit;
  const markdown = fs.readFileSync(file, "utf8");
  const rendered = { ...renderMarkdown(markdown), markdown, mtimeMs: stat.mtimeMs };
  cache.set(doc.slug, rendered);
  return rendered;
}
