/**
 * Origem de cadastro do comprador (`usuario_comprador.fonte`)
 * e cota inicial por canal.
 *
 * Valores canônicos no banco: Site | WhatsApp | Agente | (outros livres, ex. API).
 * Aliases do agente (X-Ray, AgentUI, …) gravamos como **Agente** para filtrar
 * todas as contas e buscas feitas pelo assistente.
 */

export const FONTE_SITE = "Site";
export const FONTE_WHATSAPP = "WhatsApp";
export const FONTE_AGENTE = "Agente";

const DEFAULT_LIMITE = 50;
const AGENTE_LIMITE = 500;

const AGENT_ALIASES = new Set([
  "agente",
  "agent",
  "agentui",
  "agent-ui",
  "agent_ui",
  "x-ray",
  "xray",
]);

function compactFonte(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function canonicalizeFonte(raw, fallback = "API") {
  const s = String(raw || "").trim();
  if (!s) return fallback;
  const compact = compactFonte(s);
  if (compact === "site") return FONTE_SITE;
  if (compact === "whatsapp") return FONTE_WHATSAPP;
  if (AGENT_ALIASES.has(compact)) return FONTE_AGENTE;
  return s.slice(0, 64);
}

export function isAgenteFonte(fonte) {
  return canonicalizeFonte(fonte, "") === FONTE_AGENTE;
}

export function limiteBuscasForFonte(fonte, fallback = DEFAULT_LIMITE) {
  return isAgenteFonte(fonte) ? AGENTE_LIMITE : fallback;
}
