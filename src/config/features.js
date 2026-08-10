/**
 * Feature flags / toggles de runtime.
 */

import { isProductionRuntime } from "./env.js";

/**
 * X-Ray UI + probes (harness QA / pré-proxy).
 * Local/dev: default ligado. Produção: default off — só sobe com XRAY_ENABLED=1 explícito.
 */
export function isXrayEnabled() {
  const isProd = isProductionRuntime();
  const defaultVal = isProd ? "0" : "1";
  const raw = (process.env.XRAY_ENABLED ?? defaultVal).trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}
