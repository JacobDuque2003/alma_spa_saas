const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const express = require('express');

process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../../utils/prisma');
const { sealWhatsappSecret } = require('../../utils/whatsappCredentialCrypto');
const whatsappWebhookRoutes = require('./whatsapp');
const { processWebhookPayload } = whatsappWebhookRoutes;

const TENANT_ID = 't-webhook';
const TENANT_SLUG = 'test-spa';
const PHONE_NUMBER_ID = '111222333';
const APP_SECRET = 'app-secret-de-prueba-largo';

function makeConnection() {
  const sealedToken = sealWhatsappSecret('token-de-prueba');
  const sealedSecret = sealWhatsappSecret(APP_SECRET);
  return {
    tenantId: TENANT_ID,
    phoneNumberId: PHONE_NUMBER_ID,
    status: 'activo',
    accessTokenEnc: sealedToken.enc, accessTokenIv: sealedToken.iv, accessTokenTag: sealedToken.tag,
    appSecretEnc: sealedSecret.enc, appSecretIv: sealedSecret.iv, appSecretTag: sealedSecret.tag,
    verifyTokenHash: crypto.createHash('sha256').update('verify-tok', 'utf8').digest(),
  };
}

function buildApp({ tenant, connection }) {
  prisma.tenant = { findUnique: async () => tenant };
  prisma.whatsAppConnection = { findUnique: async () => connection };
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use('/webhooks/whatsapp/:tenantSlug', whatsappWebhookRoutes);
  return app;
}

function signBody(secret, bodyString) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(bodyString, 'utf8')).digest('hex');
}

test('webhook POST: firma válida → 200', async () => {
  const app = buildApp({ tenant: { id: TENANT_ID, slug: TENANT_SLUG, active: true }, connection: makeConnection() });
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
  const app = buildApp({ tenant: { id: TENANT_ID, slug: TENANT_SLUG, active: true }, connection: makeConnection() });
  const bodyString = JSON.stringify({ entry: [] });
  const res = await request(app)
    .post(`/webhooks/whatsapp/${TENANT_SLUG}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signBody('otro-secreto', bodyString))
    .send(bodyString);
  assert.equal(res.status, 401);
});

test('webhook POST: HEADER AUSENTE → 401 (H5, sin comparación insegura)', async () => {
  const app = buildApp({ tenant: { id: TENANT_ID, slug: TENANT_SLUG, active: true }, connection: makeConnection() });
  const bodyString = JSON.stringify({ entry: [] });
  const res = await request(app)
    .post(`/webhooks/whatsapp/${TENANT_SLUG}`)
    .set('Content-Type', 'application/json')
    .send(bodyString);
  assert.equal(res.status, 401);
});

test('webhook POST: HEADER MALFORMADO → 401 (H5)', async () => {
  const app = buildApp({ tenant: { id: TENANT_ID, slug: TENANT_SLUG, active: true }, connection: makeConnection() });
  const bodyString = JSON.stringify({ entry: [] });
  const res = await request(app)
    .post(`/webhooks/whatsapp/${TENANT_SLUG}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', 'no-es-sha256-formato')
    .send(bodyString);
  assert.equal(res.status, 401);
});

test('webhook POST: tenant desconocido → 404 (nunca revela existencia del slug)', async () => {
  const app = buildApp({ tenant: null, connection: null });
  const bodyString = JSON.stringify({ entry: [] });
  const res = await request(app)
    .post(`/webhooks/whatsapp/${TENANT_SLUG}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signBody(APP_SECRET, bodyString))
    .send(bodyString);
  assert.equal(res.status, 404);
});

test('webhook POST: conexión en status ≠ activo → 404 (no HMAC contra conexiones muertas)', async () => {
  const conn = makeConnection();
  conn.status = 'error';
  const app = buildApp({ tenant: { id: TENANT_ID, slug: TENANT_SLUG, active: true }, connection: conn });
  const bodyString = JSON.stringify({ entry: [] });
  const res = await request(app)
    .post(`/webhooks/whatsapp/${TENANT_SLUG}`)
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signBody(APP_SECRET, bodyString))
    .send(bodyString);
  assert.equal(res.status, 404);
});

test('processWebhookPayload: mismo waMessageId dos veces → un solo mensaje persistido (idempotencia)', async () => {
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
