const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseTtl, prefixUnits } = require('./cachePolicy');
test('cache TTL selection uses cadence and creation costs, not only hit price', () => {
  assert.equal(chooseTtl([0, 1000, 2000, 3000]), '5m');
  const expectedDailyCadence = Array.from({ length: 30 }, (_, index) => index * 20 * 60 * 1000);
  assert.equal(chooseTtl(expectedDailyCadence), '1h');
  assert.ok(prefixUnits(expectedDailyCadence, 3600000, 2) < prefixUnits(expectedDailyCadence, 300000, 1.25));
  assert.equal(chooseTtl([0, 2 * 3600000]), '5m');
});
