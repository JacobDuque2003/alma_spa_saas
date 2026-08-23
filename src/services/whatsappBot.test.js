const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'a]G4k!mR#9sXw2Lp@vN7jQ6dY1bT0cFe';
process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const transport = require('./whatsappTransport');
const bot = require('./whatsappBot');
const state = require('./whatsappBot/state');
const rateLimit = require('./whatsappBot/rateLimit');

const TENANT = { id: 't1', slug: 'alma-spa' };
const CONN = { id: 'c1', tenantId: 't1', phoneNumberId: '999', status: 'activo' };
const CONV = { id: 'conv1', tenantId: 't1', customerWaId: '593999111222' };

// Helpers para capturar los mensajes que el bot habría enviado.
function installTransportMocks() {
  const sent = [];
  transport.sendText = async (conn, to, body) => { sent.push({ kind: 'text', to, body }); return { ok: true, data: { messages: [{ id: 'wamid.mock' }] } }; };
  transport.sendInteractive = async (conn, to, payload) => { sent.push({ kind: 'interactive', to, payload }); return { ok: true, data: { messages: [{ id: 'wamid.mock' }] } }; };
  transport.sendImageByMediaId = async (conn, to, mediaId, caption) => { sent.push({ kind: 'image', to, mediaId, caption }); return { ok: true, data: { messages: [{ id: 'wamid.mock' }] } }; };
  transport.uploadMedia = async (conn, buf, mime) => { sent.push({ kind: 'uploadMedia', bytes: buf.length, mime }); return { ok: true, mediaId: 'media_1' }; };
  transport.sanitizeError = () => ({ name: 'x', message: 'x' });
  return sent;
}

function installPrismaMocks({ humanReplied = false, services = [], serviceById = {}, imageForId = {}, clientByPhone = null, nextAppointment = null } = {}) {
  prisma.whatsAppMessage = {
    findFirst: async () => (humanReplied ? { id: 'human1' } : null),
    create: async () => ({ id: 'msg1' }),
  };
  prisma.whatsAppConversation = { update: async () => ({}) };
  prisma.service = {
    findMany: async () => services,
    findUnique: async ({ where }) => serviceById[where.id] || null,
  };
  prisma.client = { findFirst: async () => clientByPhone };
  prisma.appointment = { findFirst: async () => nextAppointment };
}

function resetState() { state._reset(); rateLimit._reset(); }

test('Fase 1: bot no responde si algún outbound humano existe (recepción ya intervino)', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({ humanReplied: true });
  await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: CONV, incoming: { type: 'text', text: { body: 'hola' } } });
  assert.equal(sent.length, 0);
});

test('Fase 1: bot no responde a conversaciones escaladas (dentro del TTL)', async () => {
  resetState();
  state.markEscalated(CONV.customerWaId);
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: CONV, incoming: { type: 'text', text: { body: 'hola' } } });
  assert.equal(sent.length, 0);
});

test('Fase 1: primer mensaje inbound texto dispara menú principal (list interactivo)', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: CONV, incoming: { type: 'text', text: { body: 'buenos días' } } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'interactive');
  assert.equal(sent[0].payload.type, 'list');
  const rows = sent[0].payload.action.sections[0].rows.map((r) => r.id);
  assert.deepEqual(rows, ['menu_list_services', 'menu_book', 'menu_my_appointment', 'menu_escalate']);
});

test('Fase 1: seleccionar "Ver servicios" del menú → lista con los activos agrupados por categoría', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    services: [
      { id: 's1', name: 'Aero yoga', category: 'yoga', priceUsd: 20, durationMins: 60, active: true },
      { id: 's2', name: 'Limpieza facial', category: 'facial', priceUsd: 30, durationMins: 75, active: true },
    ],
  });
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'menu_list_services' } } },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.type, 'list');
  const secs = sent[0].payload.action.sections.map((s) => s.title);
  assert.ok(secs.includes('facial'));
  assert.ok(secs.includes('yoga'));
});

test('Fase 1: seleccionar un servicio con imagen → sube a Meta y envía type:image con caption; luego botón "Ver menú"', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    serviceById: {
      s1: { id: 's1', tenantId: 't1', name: 'Aero yoga', category: 'yoga', priceUsd: 20, durationMins: 60, description: 'Yoga en telas.', active: true, imageMimeType: 'image/jpeg', imageUpdatedAt: new Date() },
    },
    imageForId: { s1: { data: Buffer.from([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' } },
  });
  // getServiceImage requiere una imagen "real": stub del prisma.service.findUnique
  // ya lo cubrimos con select del serviceService; pero como getServiceImage usa
  // un select distinto necesitamos otro stub. Aquí lo simulamos redefiniendo el
  // prisma.service.findUnique para devolver imageData cuando el select lo pide.
  const originalFindUnique = prisma.service.findUnique.bind(prisma.service);
  prisma.service.findUnique = async ({ where, select }) => {
    if (select && select.imageData) {
      return { tenantId: 't1', imageData: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), imageMimeType: 'image/jpeg', imageUpdatedAt: new Date() };
    }
    return originalFindUnique({ where });
  };
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'svc_s1' } } },
  });
  const kinds = sent.map((s) => s.kind);
  assert.deepEqual(kinds, ['uploadMedia', 'image', 'interactive']);
  assert.match(sent[1].caption, /Aero yoga/);
  assert.match(sent[1].caption, /Yoga en telas\./);
});

test('Fase 1: servicio SIN foto → solo texto con nombre+precio+duración+descripción, sin mencionar la falta de foto', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    serviceById: {
      s2: { id: 's2', tenantId: 't1', name: 'Limpieza facial', category: 'facial', priceUsd: 30, durationMins: 75, description: 'Extracción profunda.', active: true, imageMimeType: null },
    },
  });
  const originalFindUnique = prisma.service.findUnique.bind(prisma.service);
  prisma.service.findUnique = async ({ where, select }) => {
    if (select && select.imageData) {
      return { tenantId: 't1', imageData: null, imageMimeType: null, imageUpdatedAt: null };
    }
    return originalFindUnique({ where });
  };
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'svc_s2' } } },
  });
  const textMessages = sent.filter((s) => s.kind === 'text').map((s) => s.body);
  assert.ok(textMessages.some((b) => /Limpieza facial/.test(b)));
  assert.ok(textMessages.every((b) => !/foto|imagen/i.test(b)), 'no debe mencionar la falta de foto');
});

test('Fase 1: "Mi cita" con número que NO matchea → responde "No encuentro..." y muestra menú', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({ clientByPhone: null });
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'menu_my_appointment' } } },
  });
  assert.match(sent[0].body, /No encuentro citas a su nombre/);
  assert.equal(sent[1].kind, 'interactive'); // menú principal
});

test('Fase 1: "Mi cita" con número que matchea + hay cita próxima → devuelve detalles', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    clientByPhone: { id: 'client1', fullName: 'Ana' },
    nextAppointment: {
      id: 'appt1',
      startsAt: new Date('2026-09-01T14:00:00Z'),
      status: 'confirmado',
      service: { name: 'Aero yoga' },
      room: { name: 'Cabina 8 - YOGA' },
    },
  });
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'menu_my_appointment' } } },
  });
  const body = sent[0].body;
  assert.match(body, /Aero yoga/);
  assert.match(body, /Cabina 8 - YOGA/);
  assert.match(body, /confirmada/);
});

test('Fase 1: "Reservar" → responde con link a /reservar/<slug>', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'menu_book' } } },
  });
  assert.match(sent[0].body, /\/reservar\/alma-spa/);
});

test('Fase 1: "Hablar con recepción" marca conversación como escalada + envía confirmación', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'menu_escalate' } } },
  });
  assert.match(sent[0].body, /recepción/);
  assert.equal(state.isEscalated(CONV.customerWaId), true);
});

test('Fase 1: tono se cambia a "tú" si la clienta lo usa primero (persistente en el estado)', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'text', text: { body: '¿tienes turnos mañana?' } },
  });
  const st = state.getFlowState(CONV.customerWaId);
  assert.equal(st.tone, 'tu');
});

test('Fase 1: rate limit — al mensaje 21 en 5 min responde con aviso; del 22 en adelante silencio total', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  for (let i = 0; i < 20; i += 1) {
    await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: CONV, incoming: { type: 'text', text: { body: 'hola ' + i } } });
  }
  const countBefore = sent.length;
  await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: CONV, incoming: { type: 'text', text: { body: 'hola 21' } } });
  const warned = sent.slice(countBefore);
  assert.equal(warned.length, 1);
  assert.match(warned[0].body, /muchos mensajes/);
  const countAfterWarn = sent.length;
  for (let i = 0; i < 5; i += 1) {
    await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: CONV, incoming: { type: 'text', text: { body: 'x' } } });
  }
  assert.equal(sent.length, countAfterWarn, 'debe estar en silencio total durante cool-down');
});
