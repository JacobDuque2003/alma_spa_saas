const test = require('node:test');
const assert = require('node:assert/strict');

const aiClient = require('./aiClient');

test('calcCost: Haiku 4.5 pricing matches $1/$5 per 1M tokens', () => {
  const cost = aiClient.calcCost(1000, 100);
  const expected = 1000 * (1.0 / 1_000_000) + 100 * (5.0 / 1_000_000);
  assert.equal(cost, expected);
});

test('calcCost: zero tokens → zero cost', () => {
  assert.equal(aiClient.calcCost(0, 0), 0);
});

test('INTENT_ENUM contains all required intents', () => {
  const required = ['menu', 'list_services', 'service_info', 'book', 'my_appointment', 'cancel', 'escalate', 'unclear'];
  for (const r of required) {
    assert.ok(aiClient.INTENT_ENUM.includes(r), `missing intent: ${r}`);
  }
});

test('isAvailable: false when ANTHROPIC_API_KEY not set', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(aiClient.isAvailable(), false);
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
});

test('isAvailable: true when ANTHROPIC_API_KEY is set', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  assert.equal(aiClient.isAvailable(), true);
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
  else delete process.env.ANTHROPIC_API_KEY;
});

test('classifyIntent: rejects when ANTHROPIC_API_KEY not set', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const result = await aiClient.classifyIntent('hola');
  assert.equal(result.ok, false);
  assert.match(result.error, /ANTHROPIC_API_KEY/);
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
});

test('MODEL is claude-haiku-4-5-20251001', () => {
  assert.equal(aiClient.MODEL, 'claude-haiku-4-5-20251001');
});

test('chat prompt: saludo normal no debe mencionar domingo/cerrado/reabrimos', () => {
  const prompt = aiClient._internals.buildChatSystemPrompt({ tone: 'usted', services: [] });
  assert.match(prompt, /En saludos normales, NO menciones/);
  assert.match(prompt, /domingo/);
  assert.match(prompt, /cerrado/);
  assert.match(prompt, /reabrimos/);
});

test('chat prompt: debe interpretar faltas ortográficas y gramática informal', () => {
  const prompt = aiClient._internals.buildChatSystemPrompt({ tone: 'usted', services: [] });
  assert.match(prompt, /faltas ortográficas/);
  assert.match(prompt, /tildes omitidas/);
  assert.match(prompt, /gramática informal/);
});
