// In-memory intent cache — maps normalized text → { intent, reply }.
// TTL 24h. Saves AI calls for repeated messages ("hola", "servicios", etc.).

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

const cache = new Map(); // normalizedText → { intent, reply, expiresAt }

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function get(rawText) {
  const key = normalize(rawText);
  if (!key) return null;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { intent: entry.intent, reply: entry.reply };
}

function set(rawText, intent, reply) {
  const key = normalize(rawText);
  if (!key || !intent) return;
  cache.set(key, { intent, reply: reply || null, expiresAt: Date.now() + TTL_MS });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function size() { return cache.size; }

module.exports = {
  get,
  set,
  size,
  normalize,
  _reset: () => cache.clear(),
  TTL_MS,
};
