/**
 * Rate limiter in-memory (por processo). Generoso o bastante para QA/X-Ray.
 */

/**
 * @param {{
 *   windowMs?: number,
 *   max?: number,
 *   keyFn?: (req: import('express').Request) => string,
 *   message?: string,
 * }} [opts]
 */
export function createRateLimiter(opts = {}) {
  const windowMs = Number(opts.windowMs) || 60_000;
  const max = Number(opts.max) || 120;
  const keyFn =
    typeof opts.keyFn === "function"
      ? opts.keyFn
      : (req) => req.ip || req.headers["x-forwarded-for"] || "unknown";
  const message = opts.message || "Too many requests";

  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map();

  function prune(now) {
    if (buckets.size < 5_000) return;
    for (const [k, v] of buckets) {
      if (now >= v.resetAt) buckets.delete(k);
    }
  }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    prune(now);
    const key = String(keyFn(req) || "unknown");
    let entry = buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: message,
        status: 429,
        retry_after_sec: retryAfter,
      });
    }
    return next();
  };
}
