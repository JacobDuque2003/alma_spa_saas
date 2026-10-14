const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeState } = require('./conversationSummary');

test('summary is bounded and excludes sensitive and arbitrary state fields', () => {
  const summary = summarizeState({ clientName: 'Ana Apellido', tone: 'usted', health: 'PRIVATE', booking: {
    serviceName: 'Masaje', date: '2026-10-16', cedula: 'PRIVATE', address: 'PRIVATE', step: 'confirm', clientName: 'Ana Apellido',
  } });
  assert.match(summary, /Masaje|2026-10-16/);
  assert.doesNotMatch(summary, /PRIVATE|Apellido/);
  assert.ok(summary.split(/\s+/).length <= 60);
});
