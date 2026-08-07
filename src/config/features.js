/**
 * Feature flags / toggles de runtime.
 */

/**
 * X-Ray UI + probes (harness QA / pré-proxy).
 * Default: ligado. Para produção pública restrita: XRAY_ENABLED=0
 */
export function isXrayEnabled() {
  const raw = (process.env.XRAY_ENABLED ?? "1").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}
