const entries = new Map();
const TTL_MS = 10 * 60 * 1000;
async function load(tenantId, fetchData) {
  const existing = entries.get(tenantId);
  if (existing?.pending) return existing.pending;
  if (existing?.expiresAt > Date.now()) return existing.value;
  const entry = {};
  entries.set(tenantId, entry);
  entry.pending = (async () => {
    try {
      const value = await fetchData();
      if (entries.get(tenantId) !== entry) return load(tenantId, fetchData);
      Object.assign(entry, { value, expiresAt: Date.now() + TTL_MS });
      delete entry.pending;
      if (entries.size > 500) entries.delete(entries.keys().next().value);
      return value;
    } catch (error) {
      if (entries.get(tenantId) === entry) entries.delete(tenantId);
      throw error;
    }
  })();
  return entry.pending;
}
function invalidate(tenantId) { entries.delete(tenantId); }
module.exports = { load, invalidate, TTL_MS, _reset: () => entries.clear() };
