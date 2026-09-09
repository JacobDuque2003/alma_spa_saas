const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');

const cors = require('./cors');

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function appWithCors() {
  const app = express();
  app.use(cors);
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

test('cors permite origen configurado y expone cabeceras controladas', async () => {
  const originalAllowed = process.env.ALLOWED_ORIGINS;
  const originalEnv = process.env.NODE_ENV;
  process.env.ALLOWED_ORIGINS = 'https://panel.almaspa.test';
  process.env.NODE_ENV = 'production';

  try {
    const res = await supertest(appWithCors())
      .get('/ping')
      .set('Origin', 'https://panel.almaspa.test');

    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], 'https://panel.almaspa.test');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
    assert.match(res.headers.vary, /Origin/);
  } finally {
    restoreEnv('ALLOWED_ORIGINS', originalAllowed);
    restoreEnv('NODE_ENV', originalEnv);
  }
});

test('cors rechaza preflight de origen no configurado en produccion', async () => {
  const originalAllowed = process.env.ALLOWED_ORIGINS;
  const originalEnv = process.env.NODE_ENV;
  process.env.ALLOWED_ORIGINS = 'https://panel.almaspa.test';
  process.env.NODE_ENV = 'production';

  try {
    const res = await supertest(appWithCors())
      .options('/ping')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'Origen no permitido');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  } finally {
    restoreEnv('ALLOWED_ORIGINS', originalAllowed);
    restoreEnv('NODE_ENV', originalEnv);
  }
});
