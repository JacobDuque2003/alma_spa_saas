const test = require('node:test');
const assert = require('node:assert/strict');
const intentCache = require('./intentCache');

test('normalize: lowercases and strips accents', () => {
  assert.equal(intentCache.normalize('Hola Café'), 'hola cafe');
});

test('normalize: strips punctuation', () => {
  assert.equal(intentCache.normalize('¿Tienes cita?'), 'tienes cita');
});

test('normalize: collapses whitespace', () => {
  assert.equal(intentCache.normalize('  hola   mundo  '), 'hola mundo');
});

test('get/set: basic round-trip', () => {
  intentCache._reset();
  intentCache.set('hola', 'menu', '¡Bienvenido!');
  const result = intentCache.get('hola');
  assert.deepEqual(result, { intent: 'menu', reply: '¡Bienvenido!' });
});

test('get: case-insensitive and accent-insensitive', () => {
  intentCache._reset();
  intentCache.set('Hola café', 'menu', 'reply');
  assert.deepEqual(intentCache.get('HOLA CAFE'), { intent: 'menu', reply: 'reply' });
});

test('get: returns null for missing entry', () => {
  intentCache._reset();
  assert.equal(intentCache.get('not-cached'), null);
});

test('get: returns null for empty text', () => {
  intentCache._reset();
  assert.equal(intentCache.get(''), null);
});

test('set: ignores empty text', () => {
  intentCache._reset();
  intentCache.set('', 'menu', 'reply');
  assert.equal(intentCache.size(), 0);
});

test('set: ignores null intent', () => {
  intentCache._reset();
  intentCache.set('hola', null, 'reply');
  assert.equal(intentCache.size(), 0);
});

test('size: tracks entries', () => {
  intentCache._reset();
  assert.equal(intentCache.size(), 0);
  intentCache.set('one', 'menu', null);
  intentCache.set('two', 'book', null);
  assert.equal(intentCache.size(), 2);
});

test('_reset: clears everything', () => {
  intentCache._reset();
  intentCache.set('test', 'menu', null);
  assert.equal(intentCache.size(), 1);
  intentCache._reset();
  assert.equal(intentCache.size(), 0);
});
