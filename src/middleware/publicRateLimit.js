const buckets = new Map();

function hit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  bucket.count += 1;
  return { allowed: bucket.count <= limit, remaining: Math.max(limit - bucket.count, 0) };
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Factory de rate limit para rutas públicas HTTP (no reusa
 * barbershop/src/middleware/rateLimit.js tal cual: su getClientKey() está
 * hardcodeado al shape del webhook de WhatsApp, no a un request HTTP normal).
 */
function createPublicRateLimiter({ keyFn, limit, windowMs }) {
  return function rateLimiter(req, res, next) {
    const key = keyFn(req);
    const result = hit(key, limit, windowMs);

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      return res.sendStatus(429);
    }
    next();
  };
}

// IP simple — rutas públicas de solo lectura (services, availability).
const ipRateLimit = createPublicRateLimiter({
  keyFn: (req) => `ip:${clientIp(req)}`,
  limit: 60,
  windowMs: 60_000,
});

// IP+tenantSlug, más agresivo — rutas que escriben o que son oráculo de
// enumeración (clients/lookup, bookings, cancelación por token).
const ipTenantRateLimit = createPublicRateLimiter({
  keyFn: (req) => `ip-tenant:${clientIp(req)}:${req.params.tenantSlug || 'na'}`,
  limit: 10,
  windowMs: 60_000,
});

module.exports = { ipRateLimit, ipTenantRateLimit };
