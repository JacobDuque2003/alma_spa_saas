const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const express = require('express');

process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../../utils/prisma');
const whatsappWebhookRoutes = require('./whatsapp');
const { processWebhookPayload } = whatsappWebhookRoutes;

const TENANT_ID = 't-webhook';
const TENANT_SLUG = 'test-spa';
const PHONE_NUMBER_ID = '111222333';
const APP_SECRET = 'app-secret-de-prueba-largo';
const VERIFY_TOKEN = 'verify-tok';

function buildApp({ tenant } = {}) {
  process.env.WHATSAPP_PHONE_NUMBER_ID = PHONE_NUMBER_ID;
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;

  prisma.tenant = { findUnique: async () => tenant };
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use('/webhooks/whatsapp/:tenantSlug', whatsappWebhookRoutes);
  return app;
}

function signBody(secret, bodyString) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(bodyString, 'utf8')).digest('hex');
}

test('webhook GET: verify token correcto → 200 con challenge', async () => {
  const app = buildApp({ tenant: { id: TENANT_ID, slug: TENANT_SLUG, active: true } });
  const res = await request(app)
    .get(`/webhooks/whatsapp/${TENANT_SLUG}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=test123`);
  assert.equal(res.status, 200);
  assert.equal(res.text, 'test123');
});

test('webhook GET: verify token incorrecto → 403', async () => {
  const app = buildApp({ tenant: { id: TENANT_ID, slug: TENANT_SLUG, active: true } });
  const res = await request(app)
    .get(`/webhooks/whatsapp/${TENANT_SLUG}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test123`);
  assert.equal(res.status, 403);
});

test('webhook POST: firma válida → 200', async () => {
  const app = buildApp({ tenant: { id: TENANT_ID, slug: TENANT_SLUG, active: true } });
  const body = { entry: [] };
  const bodyString = JSON.stringify(body);
  const res = await request(app)
    .post(`/webhooks/whatsapp/${TENANT_SLUG}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signBody(APP_SECRET, bodyString))
    .send(bodyString);
  assert.equal(res.status, 200);
});

test('webhook POST: firma INVÁLIDA (secreto distinto) → 401 sin procesar', async () => {
  const app = buildApp({ tenant: { id: TENANT_ID, slug: TENANT_SLUG, active: true } });
  const bodyString = JSON.stringify({ entry: [] });
  const res = await request(app)
    .post(`/webhooks/whatsapp/${TENANT_SLUG}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signBody('otro-secreto', bodyString))
    .send(bodyString);
  assert.equal(res.status, 401);
});

test('webhook POST: HEADER AUSENTE → 401 (H5, sin comparación insegura)', async () => {
  const app = buildApp({ tenant: { id: TENANT_ID, slug: TENANT_SLUG, active: true } });
  const bodyString = JSON.stringify({ entry: [] });
  const res = await request(app)
    .post(`/webhooks/whatsapp/${TENANT_SLUG}`)
    .set('Content-Type', 'application/json')
    .send(bodyString);
  assert.equal(res.status, 401);
});

test('webhook POST: HEADER MALFORMADO → 401 (H5)', async () => {
  const app = buildApp({ tenant: { id: TENANT_ID, slug: TENANT_SLUG, active: true } });
  const bodyString = JSON.stringify({ entry: [] });
  const res = await request(app)
    .post(`/webhooks/whatsapp/${TENANT_SLUG}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', 'no-es-sha256-formato')
    .send(bodyString);
  assert.equal(res.status, 401);
});

test('webhook POST: tenant desconocido → 404 (nunca revela existencia del slug)', async () => {
  const app = buildApp({ tenant: null });
  const bodyString = JSON.stringify({ entry: [] });
  const res = await request(app)
    .post(`/webhooks/whatsapp/${TENANT_SLUG}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signBody(APP_SECRET, bodyString))
    .send(bodyString);
  assert.equal(res.status, 404);
});

test('webhook POST: WHATSAPP_APP_SECRET no configurado → 500', async () => {
  const saved = process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_APP_SECRET;
  const app = buildApp({ tenant: { id: TENANT_ID, slug: TENANT_SLUG, active: true } });
  delete process.env.WHATSAPP_APP_SECRET;
  const bodyString = JSON.stringify({ entry: [] });
  const res = await request(app)
    .post(`/webhooks/whatsapp/${TENANT_SLUG}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signBody(APP_SECRET, bodyString))
    .send(bodyString);
  assert.equal(res.status, 500);
  process.env.WHATSAPP_APP_SECRET = saved;
});

test('processWebhookPayload: mismo waMessageId dos veces → un solo mensaje persistido (idempotencia)', async () => {
  process.env.WHATSAPP_PHONE_NUMBER_ID = PHONE_NUMBER_ID;
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';

  const stored = new Map();
  prisma.whatsAppMessage = {
    findUnique: async ({ where }) => stored.get(where.waMessageId) || null,
    create: async ({ data }) => {
      if (stored.has(data.waMessageId)) {
        const err = new Error('unique'); err.code = 'P2002'; throw err;
      }
      stored.set(data.waMessageId, data);
      return data;
    },
  };
  prisma.client = { findFirst: async () => null };
  prisma.whatsAppConversation = {
    upsert: async () => ({ id: 'c1', tenantId: TENANT_ID }),
    update: async () => ({ id: 'c1' }),
  };

  const payload = {
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      messages: [{ id: 'wamid.ABC', from: '593999000001', type: 'text', text: { body: 'Hola' }, timestamp: '1720000000' }],
    } }] }],
  };
  const tenant = { id: TENANT_ID, slug: TENANT_SLUG };
  const conn = { phoneNumberId: PHONE_NUMBER_ID };
  await processWebhookPayload(tenant, conn, payload);
  await processWebhookPayload(tenant, conn, payload);
  assert.equal(stored.size, 1, 'debe haber 1 mensaje persistido, no 2');
});
