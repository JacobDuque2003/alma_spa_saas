const DEFAULT_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];

function configuredOrigins() {
  const configured = (process.env.ALLOWED_ORIGINS || process.env.PUBLIC_BASE_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (process.env.NODE_ENV !== 'production') {
    return new Set([...configured, ...DEFAULT_DEV_ORIGINS]);
  }
  return new Set(configured);
}

function applyCorsHeaders(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-Alma-Out-Of-Schedule, X-Alma-Out-Of-Schedule-Next');
  res.vary('Origin');
}

function cors(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) return next();

  const allowed = configuredOrigins().has(origin);
  if (allowed) {
    applyCorsHeaders(res, origin);
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }

  res.vary('Origin');
  if (req.method === 'OPTIONS') {
    return res.status(403).json({ error: 'Origen no permitido' });
  }
  return next();
}

module.exports = cors;
