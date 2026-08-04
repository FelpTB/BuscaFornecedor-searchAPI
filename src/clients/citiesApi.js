/**
 * Cliente HTTP da API-busca-cidades (expansão geográfica).
 * @see docs/support-api-busca-cidades.md
 */

const DEFAULT_BASE =
  process.env.CITIES_API_URL?.trim() ||
  "https://api-busca-cidades-buscafornecedor.up.railway.app";

const MAX_CITIES = Number(process.env.CITIES_FILTER_MAX) || 80;
const FETCH_TIMEOUT_MS = Number(process.env.CITIES_API_TIMEOUT_MS) || 12_000;

/**
 * @param {{ city_name: string, uf?: string|null, radius_km: number, baseUrl?: string }} params
 * @returns {Promise<{
 *   center_city: object,
 *   nearby_cities: object[],
 *   city_names: string[],
 *   total_found: number,
 *   radius_km: number,
 *   truncated: boolean,
 *   source: string
 * }>}
 */
export async function fetchCitiesNearby({ city_name, uf, radius_km, baseUrl } = {}) {
  const name = typeof city_name === "string" ? city_name.trim() : "";
  if (!name) {
    const err = new Error("city_name é obrigatório para busca de cidades");
    err.status = 400;
    throw err;
  }

  const radius = Number(radius_km);
  if (!Number.isFinite(radius) || radius <= 0) {
    const err = new Error("radius_km deve ser um número > 0");
    err.status = 400;
    throw err;
  }
  if (radius > 500) {
    const err = new Error("radius_km máximo permitido: 500");
    err.status = 400;
    throw err;
  }

  const base = (baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  const qs = new URLSearchParams({
    city_name: name,
    radius_km: String(radius),
  });
  if (uf && String(uf).trim()) qs.set("uf", String(uf).trim().toUpperCase());

  const url = `${base}/api/cities/nearby?${qs}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    const err = new Error(
      e?.name === "AbortError"
        ? "Timeout ao consultar API de cidades"
        : `Falha ao consultar API de cidades: ${e.message || e}`,
    );
    err.status = 502;
    err.cause = e;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `API cidades HTTP ${res.status}`);
    err.status = res.status === 404 ? 404 : 502;
    err.data = data;
    throw err;
  }

  const nearby = Array.isArray(data.nearby_cities) ? data.nearby_cities : [];
  const allNames = nearby
    .map((c) => (typeof c?.name === "string" ? c.name.trim() : ""))
    .filter(Boolean);

  // Dedup preservando ordem (centro primeiro)
  const seen = new Set();
  const unique = [];
  for (const n of allNames) {
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(n);
  }

  const truncated = unique.length > MAX_CITIES;
  const city_names = truncated ? unique.slice(0, MAX_CITIES) : unique;

  return {
    center_city: data.center_city || null,
    nearby_cities: nearby,
    city_names,
    total_found: data.total_found ?? unique.length,
    radius_km: data.radius_km ?? radius,
    truncated,
    max_cities: MAX_CITIES,
    source: url,
  };
}

export function getCitiesApiBase() {
  return DEFAULT_BASE.replace(/\/$/, "");
}
