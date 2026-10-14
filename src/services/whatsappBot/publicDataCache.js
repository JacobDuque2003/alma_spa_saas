const entries = new Map();
const TTL_MS = 10 * 60 * 1000;
async function load(tenantId, fetchData) {
  const existing = entries.get(tenantId);
  if (existing?.expiresAt > Date.now()) return existing.value;
  const value = await fetchData();
  entries.set(tenantId, { value, expiresAt: Date.now() + TTL_MS });
  if (entries.size > 500) entries.delete(entries.keys().next().value);
  return value;
}
function invalidate(tenantId) { entries.delete(tenantId); }
module.exports = { load, invalidate, TTL_MS, _reset: () => entries.clear() };
