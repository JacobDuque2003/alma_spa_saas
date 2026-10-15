function prefixUnits(times, ttlMs, writePrice) {
  let expires = -Infinity, cost = 0;
  for (const time of [...times].sort((a, b) => a - b)) {
    cost += time < expires ? 0.1 : writePrice;
    expires = time + ttlMs;
  }
  return cost;
}
function chooseTtl(times) {
  if (times.length < 2) return '1h';
  return prefixUnits(times, 300000, 1.25) <= prefixUnits(times, 3600000, 2) ? '5m' : '1h';
}
module.exports = { prefixUnits, chooseTtl };
