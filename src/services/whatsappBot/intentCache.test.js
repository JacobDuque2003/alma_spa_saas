const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('./intentCache');
test('intent cache is tenant scoped and never retains replies or contextual parameters', () => {
  cache._reset();
  cache.set('t1', 'Donde quedan?', 'location', { reply: 'PRIVATE', name: 'PRIVATE' });
  assert.deepEqual(cache.get('t1', 'donde quedan'), { intent: 'location', params: {} });
  assert.equal(cache.get('t2', 'donde quedan'), null);
  assert.equal(cache.metrics('t1').hitRate, 1);
});
test('intent cache rejects actions and contextual short replies', () => {
  cache._reset();
  for (const text of ['si', 'ese', 'manana', 'viernes', 'a las 4']) cache.set('t1', text, 'greeting');
  cache.set('t1', 'quiero cita', 'book_service');
  cache.set('t1', '', 'greeting');
  assert.equal(cache.size(), 0);
});
test('intent normalization strips accents, punctuation and redundant spaces', () => {
  assert.equal(cache.normalize(' ?HOLA   Cafe? '), 'hola cafe');
});
