import { Router } from "express";
import { DOCS, findDoc, getRenderedDoc } from "./renderDocs.js";
import { getDocsHtml } from "./docsHtml.js";

/**
 * Documentação pública da API: GET /docs, /docs/:slug (HTML) e /docs/:slug.md (markdown).
 * Conteúdo = docs/api/*.md (sem auth; não contém secrets).
 */
export function createDocsRouter() {
  const router = Router();

  router.get("/docs", (_req, res) => res.redirect(302, `/docs/${DOCS[0].slug}`));

  router.get("/docs/:slug.md", (req, res, next) => {
    const doc = findDoc(req.params.slug);
    if (!doc) return next();
    const { markdown } = getRenderedDoc(doc);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    return res.send(markdown);
  });

  router.get("/docs/:slug", (req, res, next) => {
    const doc = findDoc(req.params.slug);
    if (!doc) return next();
    const { html, toc } = getRenderedDoc(doc);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    return res.send(getDocsHtml({ doc, html, toc }));
  });

  return router;
}
