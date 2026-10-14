const TTL_MS = 24 * 60 * 60 * 1000;
const { normalizeText } = require('./textNormalize');
const cache = new Map();
const stats = new Map();
const SAFE_INTENTS = new Set(['greeting', 'list_services', 'business_hours', 'location', 'farewell']);
function normalize(text) {
  return normalizeText(text);
}
function key(tenantId, text) { return JSON.stringify([tenantId, normalize(text)]); }
function get(tenantId, text) {
  if (!tenantId || !normalize(text)) return null;
  const metrics = stats.get(tenantId) || { hits: 0, misses: 0 };
  const value = cache.get(key(tenantId, text));
  if (!value || value.expiresAt <= Date.now()) {
    cache.delete(key(tenantId, text)); metrics.misses++; stats.set(tenantId, metrics); return null;
  }
  metrics.hits++; stats.set(tenantId, metrics);
  return { intent: value.intent, params: {} };
}
function set(tenantId, text, intent) {
  if (!tenantId || !normalize(text) || !SAFE_INTENTS.has(intent)) return;
  if (/\b(si|ese|esa|segundo|manana|hoy|ayer|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b|\d/.test(normalize(text))) return;
  cache.set(key(tenantId, text), { intent, expiresAt: Date.now() + TTL_MS });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
}
function metrics(tenantId) {
  const value = stats.get(tenantId) || { hits: 0, misses: 0 };
  return { ...value, hitRate: value.hits + value.misses ? value.hits / (value.hits + value.misses) : null };
}
module.exports = { get, set, normalize, metrics, TTL_MS, size: () => cache.size,
  _reset: () => { cache.clear(); stats.clear(); } };
