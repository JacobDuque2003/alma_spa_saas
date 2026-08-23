const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://alma-spa.test';

const prisma = require('../utils/prisma');
const transport = require('./whatsappTransport');
const inbox = require('./whatsappInboxService');

function mockTransport(overrides = {}) {
  transport.loadActiveConnection = overrides.loadActiveConnection || (async () => ({
    tenantId: 't1', phoneNumberId: '111', status: 'activo',
  }));
  transport.sendText = overrides.sendText || (async () => ({ ok: true, data: { messages: [{ id: 'wamid.NEW' }] } }));
  transport.sendTemplate = overrides.sendTemplate || (async () => ({ ok: true, data: { messages: [{ id: 'wamid.NEW' }] } }));
}

test('sendManualText: FUERA de la ventana de 24h → 422 WINDOW_CLOSED', async () => {
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', lastInboundAt: new Date(Date.now() - 25 * 3600 * 1000) }),
  };
  await assert.rejects(
    () => inbox.sendManualText({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', 'hola'),
    (err) => err.status === 422 && /WINDOW_CLOSED/.test(err.message)
  );
});

test('sendManualText: DENTRO de la ventana → llama sendText, no sendTemplate', async () => {
  let textCalls = 0, templateCalls = 0;
  mockTransport({
    sendText: async () => { textCalls += 1; return { ok: true, data: { messages: [{ id: 'wamid.X' }] } }; },
    sendTemplate: async () => { templateCalls += 1; return { ok: true, data: {} }; },
  });
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', customerWaId: '593999', lastInboundAt: new Date(Date.now() - 60 * 1000) }),
    update: async () => ({}),
  };
  prisma.whatsAppMessage = {
    create: async ({ data }) => ({ id: 'm1', ...data }),
    update: async ({ data }) => ({ id: 'm1', ...data }),
  };
  const msg = await inbox.sendManualText({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', 'texto libre');
  assert.equal(textCalls, 1);
  assert.equal(templateCalls, 0);
  assert.equal(msg.status, 'sent');
});

test('sendReminder: SIEMPRE plantilla (dentro o fuera de la ventana)', async () => {
  let textCalls = 0, templateCalls = 0;
  mockTransport({
    sendText: async () => { textCalls += 1; return { ok: true, data: {} }; },
    sendTemplate: async () => { templateCalls += 1; return { ok: true, data: { messages: [{ id: 'wamid.T' }] } }; },
  });
  prisma.whatsAppConversation = {
    findUnique: async () => ({
      id: 'c1', tenantId: 't1', customerWaId: '593999', clientId: 'cli1',
      lastInboundAt: new Date(Date.now() - 25 * 3600 * 1000), // FUERA de la ventana
    }),
    update: async () => ({}),
  };
  let reminderWhere = null;
  prisma.appointment = {
    findFirst: async (args) => {
      reminderWhere = args.where;
      return { id: 'a1', tenantId: 't1', clientId: 'cli1', confirmationToken: 'token-x', startsAt: new Date(Date.now() + 3600 * 1000), service: { name: 'Masaje' }, client: { fullName: 'Maria Perez', active: true } };
    },
  };
  prisma.tenant = { findUnique: async () => ({ config: { whatsapp: { confirmationTemplate: { name: 'confirm_v1', language: 'es' } } } }) };
  let created;
  prisma.whatsAppMessage = {
    create: async ({ data }) => { created = { id: 'm1', ...data }; return created; },
    update: async ({ data }) => ({ ...created, ...data }),
  };

  const msg = await inbox.sendReminder({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1');
  assert.equal(textCalls, 0);
  assert.equal(templateCalls, 1);
  assert.deepEqual(reminderWhere.client, { is: { active: true } });
  assert.equal(msg.templateName, 'confirm_v1');
  assert.equal(msg.status, 'sent');
});

test('sendReminder: sin cita pendiente futura → 400', async () => {
  mockTransport();
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', customerWaId: '593999', clientId: 'cli1' }),
  };
  prisma.appointment = { findFirst: async () => null };
  await assert.rejects(
    () => inbox.sendReminder({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1'),
    (err) => err.status === 400
  );
});

test('sendReminder: clienta deshabilitada no recibe plantilla', async () => {
  mockTransport();
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', customerWaId: '593999', clientId: 'cli1' }),
  };
  let apptWhere = null;
  prisma.appointment = {
    findFirst: async (args) => { apptWhere = args.where; return null; },
  };

  await assert.rejects(
    () => inbox.sendReminder({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1'),
    (err) => err.status === 400
  );
  assert.deepEqual(apptWhere.client, { is: { active: true } });
});

test('listConversations filter=sin_confirmar_hoy: cruza con Appointment.status pendiente hoy', async () => {
  let apptQuery = null;
  prisma.tenant = { findUnique: async () => ({ config: {} }) };
  prisma.appointment = {
    findMany: async (args) => { apptQuery = args.where; return [{ clientId: 'cli1' }, { clientId: 'cli2' }]; },
  };
  let convQuery = null;
  prisma.whatsAppConversation = {
    findMany: async (args) => {
      convQuery = args.where;
      return [{ id: 'conv1', customerWaId: '593999', tenantId: 't1', lastMessageAt: new Date(), lastInboundAt: new Date(), client: { id: 'cli1', fullName: 'A' } }];
    },
  };
  // El nuevo lookup de "conversaciones donde recepción ya respondió" (para
  // marcar botStatus='handedOff' en la Bandeja) usa whatsAppMessage.groupBy —
  // devolvemos vacío para este test: ninguna conversación cedió al humano.
  prisma.whatsAppMessage = { groupBy: async () => [] };
  const { items } = await inbox.listConversations({ tenantId: 't1', role: 'personal' }, { filter: 'sin_confirmar_hoy' });
  assert.equal(apptQuery.status, 'pendiente', 'debe filtrar por status pendiente en Appointment');
  assert.deepEqual(apptQuery.client, { is: { active: true } }, 'debe excluir clientas deshabilitadas de recordatorios');
  assert.ok(apptQuery.startsAt.gte instanceof Date && apptQuery.startsAt.lt instanceof Date, 'debe usar rango [gte, lt) sargable');
  assert.deepEqual([...convQuery.clientId.in], ['cli1', 'cli2']);
  assert.equal(items.length, 1);
});
