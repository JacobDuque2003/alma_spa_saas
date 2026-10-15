const test = require('node:test');
const assert = require('node:assert/strict');
const base = require('../whatsappTransport');
const transport = require('./turnTransport');
test('two bot sends in one turn become one Meta message with original controls', async (t) => {
  const calls = [];
  t.mock.method(base, 'sendInteractive', async (_conn, _to, payload) => { calls.push(payload); return { ok: true }; });
  await transport.withTurn(async () => {
    await transport.sendText({}, 'synthetic', 'Resumen');
    await transport.sendInteractive({}, 'synthetic', { type: 'button', body: { text: 'Confirmar' }, action: { buttons: [{ reply: { id: 'yes', title: 'Si' } }] } });
  }, async () => {}, () => {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action.buttons[0].reply.id, 'yes');
  assert.match(calls[0].body.text, /Resumen\n\nConfirmar/);
});
test('long public information is paginated without losing its safety warning', async (t) => {
  let output, pages;
  t.mock.method(base, 'sendText', async (_conn, _to, text) => { output = text; return { ok: true }; });
  const text = 'a'.repeat(7000) + 'ADVERTENCIA_FINAL';
  await transport.withTurn(() => transport.sendText({}, 'synthetic', text), async () => {}, (rest) => { pages = rest; });
  assert.ok(output.length < 4096);
  assert.match(pages.join(''), /ADVERTENCIA_FINAL/);
});
