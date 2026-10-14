const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('./publicDataCache');
test('public cache isolates tenants and invalidates edited data', async () => {
  cache._reset();
  let reads = 0;
  const fetch = async () => ++reads;
  assert.equal(await cache.load('one', fetch), 1);
  assert.equal(await cache.load('one', fetch), 1);
  assert.equal(await cache.load('two', fetch), 2);
  cache.invalidate('one');
  assert.equal(await cache.load('one', fetch), 3);
});
test('failed public cache reads are not cached', async () => {
  cache._reset();
  await assert.rejects(cache.load('one', async () => { throw Error('unavailable'); }));
  assert.equal(await cache.load('one', async () => 'fresh'), 'fresh');
});
