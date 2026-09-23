const test = require('node:test');
const assert = require('node:assert/strict');
const telegram = require('./telegramAlertService');

test('Telegram queda desactivado si faltan credenciales', () => {
  const saved = { ...process.env };
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_ALERT_CHAT_ID;
  assert.equal(telegram.isEnabled(), false);
  process.env = saved;
});

test('sendAlert envía al chat configurado y deduplica errores repetidos', async () => {
  const originalFetch = global.fetch;
  process.env.TELEGRAM_BOT_TOKEN = 'token-prueba';
  process.env.TELEGRAM_ALERT_CHAT_ID = '12345';
  process.env.TELEGRAM_ALERTS_ENABLED = 'true';
  telegram.resetForTests();
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200 };
  };
  try {
    const first = await telegram.sendAlert({ severity: 'critical', title: 'Meta falló', dedupeKey: 'meta:test' });
    const second = await telegram.sendAlert({ severity: 'critical', title: 'Meta falló', dedupeKey: 'meta:test' });
    assert.equal(first.ok, true);
    assert.equal(second.skipped, 'deduplicated');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.chat_id, '12345');
    assert.match(calls[0].body.text, /^🔴 \[Alma_Spa\] Meta falló/);
    assert.match(calls[0].body.text, /\(Ecuador\)/);
  } finally {
    global.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    delete process.env.TELEGRAM_ALERTS_ENABLED;
  }
});
