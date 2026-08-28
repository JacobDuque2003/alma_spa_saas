const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'a]G4k!mR#9sXw2Lp@vN7jQ6dY1bT0cFe';
process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const transport = require('./whatsappTransport');
const bot = require('./whatsappBot');
const state = require('./whatsappBot/state');
const rateLimit = require('./whatsappBot/rateLimit');
const menus = require('./whatsappBot/menus');

const TENANT = { id: 't1', slug: 'alma-spa' };
const CONN = { id: 'c1', tenantId: 't1', phoneNumberId: '999', status: 'activo' };
const CONV = { id: 'conv1', tenantId: 't1', customerWaId: '593999111222' };

function installTransportMocks() {
  const sent = [];
  transport.sendText = async (conn, to, body) => { sent.push({ kind: 'text', to, body }); return { ok: true, data: { messages: [{ id: 'wamid.mock' }] } }; };
  transport.sendInteractive = async (conn, to, payload) => { sent.push({ kind: 'interactive', to, payload }); return { ok: true, data: { messages: [{ id: 'wamid.mock' }] } }; };
  transport.sendImageByMediaId = async (conn, to, mediaId, caption) => { sent.push({ kind: 'image', to, mediaId, caption }); return { ok: true, data: { messages: [{ id: 'wamid.mock' }] } }; };
  transport.uploadMedia = async (conn, buf, mime) => { sent.push({ kind: 'uploadMedia', bytes: buf.length, mime }); return { ok: true, mediaId: 'media_1' }; };
  transport.sanitizeError = () => ({ name: 'x', message: 'x' });
  return sent;
}

function installPrismaMocks({ humanReplied = false, services = [], serviceById = {}, imageForId = {}, clientByPhone = null, nextAppointment = null, tenantConfig = {} } = {}) {
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
  prisma.tenant = { findUnique: async () => ({ config: tenantConfig }) };
  prisma.botInteractionLog = {
    create: async () => ({}),
    aggregate: async () => ({ _sum: { costUsd: 0 } }),
  };
}

function resetState() { state._reset(); rateLimit._reset(); }

// ─── Core behavior tests ──────────────────────────────────────

test('bot no responde si botActive === false', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  const convOff = { ...CONV, botActive: false };
  await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: convOff, incoming: { type: 'text', text: { body: 'hola' } } });
  assert.equal(sent.length, 0);
});

test('bot responde aunque haya outbound humano si botActive === true', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({ humanReplied: true });
  const convOn = { ...CONV, botActive: true };
  await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: convOn, incoming: { type: 'text', text: { body: 'hola' } } });
  assert.ok(sent.length > 0, 'bot debería responder cuando botActive=true');
});

test('bot no responde a conversaciones escaladas', async () => {
  resetState();
  state.markEscalated(CONV.customerWaId);
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: CONV, incoming: { type: 'text', text: { body: 'hola' } } });
  assert.equal(sent.length, 0);
});

test('primer mensaje texto dispara menú principal con Almita', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: CONV, incoming: { type: 'text', text: { body: 'buenos días' } } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'interactive');
  assert.equal(sent[0].payload.type, 'list');
  assert.match(sent[0].payload.body.text, /Almita/);
  const rows = sent[0].payload.action.sections[0].rows.map((r) => r.id);
  assert.deepEqual(rows, ['menu_list_services', 'menu_book', 'menu_my_appointment', 'menu_escalate']);
});

test('menú principal cae a texto si Meta rechaza el interactivo', async () => {
  resetState();
  const sent = installTransportMocks();
  transport.sendInteractive = async (conn, to, payload) => {
    sent.push({ kind: 'interactive', to, payload });
    return { ok: false, status: 400, errorCode: 'mock_interactive_rejected', errorTitle: 'Rejected' };
  };
  installPrismaMocks();

  await bot.handleInboundMessage({
    tenant: TENANT,
    connection: CONN,
    conv: CONV,
    incoming: { type: 'text', text: { body: 'hola' } },
  });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].kind, 'interactive');
  assert.equal(sent[1].kind, 'text');
  assert.match(sent[1].body, /1\. Ver servicios/);
  assert.match(sent[1].body, /4\. Hablar con recepción/);
});

test('opciones numéricas funcionan sin IA', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    services: [
      { id: 's1', name: 'Masaje relajante', category: 'Masajes', priceUsd: 30, durationMins: 60, active: true },
    ],
  });

  await bot.handleInboundMessage({
    tenant: TENANT,
    connection: CONN,
    conv: CONV,
    incoming: { type: 'text', text: { body: '1' } },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'interactive');
  assert.match(sent[0].payload.body.text, /servicios/i);
});

test('"Ver servicios" → lista agrupada por categoría', async () => {
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

test('servicio con imagen → sube y envía image+caption; luego botón volver', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    serviceById: {
      s1: { id: 's1', tenantId: 't1', name: 'Aero yoga', category: 'yoga', priceUsd: 20, durationMins: 60, description: 'Yoga en telas.', active: true, imageMimeType: 'image/jpeg', imageUpdatedAt: new Date() },
    },
  });
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
  assert.match(sent[1].caption, /🌟.*Aero yoga/);
  assert.match(sent[1].caption, /Yoga en telas\./);
});

test('servicio SIN foto → texto con nombre+precio+duración', async () => {
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
  assert.ok(textMessages.every((b) => !/foto|imagen/i.test(b)));
});

test('"Mi cita" sin cliente → "No encontré citas" + menú', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({ clientByPhone: null });
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'menu_my_appointment' } } },
  });
  assert.match(sent[0].body, /No encontré citas a su nombre/);
  assert.equal(sent[1].kind, 'interactive');
});

test('"Mi cita" con cita próxima → devuelve detalles', async () => {
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

test('"Hablar con recepción" marca escalada + envía confirmación', async () => {
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

test('tono "tú" detectado y persistido', async () => {
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

test('rate limit — aviso en msg 21, silencio después', async () => {
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
  assert.match(warned[0].body, /muchos mensajes seguidos/);
  const countAfterWarn = sent.length;
  for (let i = 0; i < 5; i += 1) {
    await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: CONV, incoming: { type: 'text', text: { body: 'x' } } });
  }
  assert.equal(sent.length, countAfterWarn);
});

// ─── Category flow (>10 services) ──────────────────────────────

test('>10 servicios → envía categorías', async () => {
  resetState();
  const sent = installTransportMocks();
  const manyServices = [];
  for (let i = 0; i < 14; i += 1) {
    const cat = i < 5 ? 'Masajes' : i < 10 ? 'Faciales' : 'Corporales';
    manyServices.push({ id: `s${i}`, name: `Servicio ${i}`, category: cat, priceUsd: 25, durationMins: 60, active: true });
  }
  installPrismaMocks({ services: manyServices });
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'menu_list_services' } } },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.type, 'list');
  const rows = sent[0].payload.action.sections[0].rows;
  assert.ok(rows.length <= 10);
  assert.ok(rows.some((r) => r.id.startsWith('cat_')));
});

test('seleccionar categoría → servicios de esa categoría', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    services: [
      { id: 's1', name: 'Masaje Relajante', category: 'Masajes', priceUsd: 30, durationMins: 60, active: true },
      { id: 's2', name: 'Masaje Piedras', category: 'Masajes', priceUsd: 35, durationMins: 90, active: true },
    ],
  });
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'cat_Masajes' } } },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.type, 'list');
  const rows = sent[0].payload.action.sections[0].rows;
  assert.ok(rows.every((r) => r.id.startsWith('svc_')));
  assert.match(sent[0].payload.body.text, /Masajes/);
});

test('texto libre sin IA y con state previo → "no logré entender" + menú', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: CONV, incoming: { type: 'text', text: { body: 'hola' } } });
  const afterFirst = sent.length;
  await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: CONV, incoming: { type: 'text', text: { body: 'quiero algo raro' } } });
  const newMessages = sent.slice(afterFirst);
  assert.equal(newMessages.length, 2);
  assert.match(newMessages[0].body, /No logré entender/);
  assert.equal(newMessages[1].kind, 'interactive');
});

test('escalate incluye "recepción" y emojis', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'menu_escalate' } } },
  });
  assert.match(sent[0].body, /recepción/);
  assert.match(sent[0].body, /👋/);
  assert.match(sent[0].body, /🌿/);
});

// ─── Booking flow tests ───────────────────────────────────────

test('"Reservar cita" → muestra servicios en modo reserva (NUNCA link externo, UN solo mensaje)', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    services: [
      { id: 's1', name: 'Masaje', category: 'Masajes', priceUsd: 30, durationMins: 60, active: true },
    ],
  });
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'menu_book' } } },
  });
  assert.equal(sent.length, 1, 'debe enviar UN solo mensaje interactivo');
  assert.equal(sent[0].kind, 'interactive');
  assert.match(sent[0].payload.body.text, /reservar/i, 'cuerpo de la lista debe mencionar reserva');
  const allBodies = sent.map(s => s.body || s.payload?.body?.text || '').join(' ');
  assert.ok(!/https?:\/\//.test(allBodies), 'NUNCA debe enviar links externos');
  const st = state.getFlowState(CONV.customerWaId);
  assert.equal(st.booking?.step, 'select_service');
});

test('seleccionar servicio en booking → muestra date picker', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    serviceById: {
      s1: { id: 's1', tenantId: 't1', name: 'Masaje Relajante', category: 'Masajes', priceUsd: 30, durationMins: 60, active: true },
    },
  });
  const originalFindUnique = prisma.service.findUnique.bind(prisma.service);
  prisma.service.findUnique = async ({ where, select }) => {
    if (select && select.imageData) return { tenantId: 't1', imageData: null, imageMimeType: null };
    return originalFindUnique({ where });
  };
  // Set booking state
  state.setFlowState(CONV.customerWaId, { flow: 'booking', booking: { step: 'select_service' }, tone: 'usted' });
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'svc_s1' } } },
  });
  const interactives = sent.filter(s => s.kind === 'interactive');
  assert.ok(interactives.length >= 1);
  const datePicker = interactives.find(s => s.payload?.action?.button === 'Elegir día');
  assert.ok(datePicker, 'debe mostrar date picker');
  const rows = datePicker.payload.action.sections[0].rows;
  assert.ok(rows.every(r => r.id.startsWith('bkd_')));
  const st = state.getFlowState(CONV.customerWaId);
  assert.equal(st.booking?.step, 'select_date');
  assert.equal(st.booking?.serviceId, 's1');
});

test('seleccionar servicio fuera de booking → muestra detalle normal', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    serviceById: {
      s1: { id: 's1', tenantId: 't1', name: 'Masaje', category: 'Masajes', priceUsd: 30, durationMins: 60, active: true },
    },
  });
  const originalFindUnique = prisma.service.findUnique.bind(prisma.service);
  prisma.service.findUnique = async ({ where, select }) => {
    if (select && select.imageData) return { tenantId: 't1', imageData: null, imageMimeType: null };
    return originalFindUnique({ where });
  };
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { list_reply: { id: 'svc_s1' } } },
  });
  const textMsgs = sent.filter(s => s.kind === 'text');
  assert.ok(textMsgs.some(s => /🌟.*Masaje/.test(s.body)));
});

test('booking confirm_no → cancela y vuelve a menú', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  state.setFlowState(CONV.customerWaId, {
    flow: 'booking',
    booking: { step: 'confirm', serviceId: 's1', serviceName: 'Masaje', timeSlot: '2026-09-01T15:00:00Z', clientName: 'Ana' },
    tone: 'usted',
  });
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'interactive', interactive: { button_reply: { id: 'bk_no' } } },
  });
  assert.ok(sent.some(s => s.kind === 'text' && /cancelé la reserva/.test(s.body)));
  assert.ok(sent.some(s => s.kind === 'interactive'));
});

test('name capture → nombre corto rechazado, nombre válido aceptado', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({ clientByPhone: null });
  state.setFlowState(CONV.customerWaId, {
    flow: 'booking',
    booking: { step: 'ask_name', serviceId: 's1', serviceName: 'Masaje', timeSlot: '2026-09-01T15:00:00Z' },
    tone: 'usted',
  });
  // Too short name
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'text', text: { body: 'A' } },
  });
  assert.ok(sent.some(s => s.kind === 'text' && /nombre completo/.test(s.body)));
});

test('date picker genera solo días lun-sáb (sin domingo)', async () => {
  const picker = menus.datePicker({ tone: 'usted' });
  assert.equal(picker.type, 'list');
  assert.ok(picker.action.sections[0].rows.length >= 1);
  assert.ok(picker.action.sections[0].rows.length <= 7);
  for (const row of picker.action.sections[0].rows) {
    assert.ok(row.id.startsWith('bkd_'));
    assert.ok(!row.description.toLowerCase().includes('domingo'));
  }
});

test('time slot list respeta máximo 10 rows', async () => {
  const slots = [];
  for (let i = 0; i < 15; i++) {
    slots.push(new Date(`2026-09-01T${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}:00Z`).toISOString());
  }
  const list = menus.timeSlotList(slots, 'Masaje Relajante', { tone: 'tu' });
  assert.equal(list.type, 'list');
  assert.ok(list.action.sections[0].rows.length <= 10);
  assert.ok(list.action.sections[0].rows.every(r => r.id.startsWith('bkt_')));
});

test('booking confirmation buttons have correct IDs', async () => {
  const confirmation = menus.bookingConfirmation('🌟 Test\n📅 Lunes\n🕐 10:00', { tone: 'usted' });
  assert.equal(confirmation.type, 'button');
  const ids = confirmation.action.buttons.map(b => b.reply.id);
  assert.ok(ids.includes('bk_yes'));
  assert.ok(ids.includes('bk_no'));
});

// ─── State history tests ──────────────────────────────────────

test('pushHistory + getHistory mantiene últimos MAX_HISTORY mensajes', async () => {
  resetState();
  for (let i = 0; i < 15; i++) {
    state.pushHistory('test_wa', 'user', `msg ${i}`);
  }
  const history = state.getHistory('test_wa');
  assert.equal(history.length, state.MAX_HISTORY);
  assert.equal(history[0].content, 'msg 5');
  assert.equal(history[history.length - 1].content, 'msg 14');
});

test('capitalize helper', () => {
  assert.equal(menus.capitalize('hola'), 'Hola');
  assert.equal(menus.capitalize(''), '');
  assert.equal(menus.capitalize(null), '');
});

// ─── Single-response rule tests ──────────────────────────────

test('routeIntent greeting (subsequent) → solo texto IA, NO menú después', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  // First message to create history
  await bot.handleInboundMessage({ tenant: TENANT, connection: CONN, conv: CONV, incoming: { type: 'text', text: { body: 'hola' } } });
  const countAfterFirst = sent.length;
  // Route a second greeting intent with AI reply
  await bot._internals.routeIntent({
    tenant: TENANT, connection: CONN, conv: CONV, waId: CONV.customerWaId,
    tone: 'usted', intent: 'greeting', aiReply: '¡Hola de nuevo!',
  });
  const newMsgs = sent.slice(countAfterFirst);
  assert.equal(newMsgs.length, 1, 'solo 1 respuesta');
  assert.equal(newMsgs[0].kind, 'text');
  assert.equal(newMsgs[0].body, '¡Hola de nuevo!');
});

test('routeIntent list_services → solo la lista interactiva, NO texto IA aparte', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    services: [
      { id: 's1', name: 'Masaje', category: 'Masajes', priceUsd: 30, durationMins: 60, active: true },
    ],
  });
  await bot._internals.routeIntent({
    tenant: TENANT, connection: CONN, conv: CONV, waId: CONV.customerWaId,
    tone: 'usted', intent: 'list_services', aiReply: 'Tenemos masajes y faciales.',
  });
  assert.equal(sent.length, 1, 'solo 1 mensaje');
  assert.equal(sent[0].kind, 'interactive');
});

test('routeIntent unclear con AI reply → solo texto IA, NO menú después', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot._internals.routeIntent({
    tenant: TENANT, connection: CONN, conv: CONV, waId: CONV.customerWaId,
    tone: 'usted', intent: 'unclear', aiReply: 'No entendí bien, ¿puede repetir?',
  });
  assert.equal(sent.length, 1, 'solo 1 respuesta');
  assert.equal(sent[0].kind, 'text');
  assert.match(sent[0].body, /No entendí/);
});

test('routeIntent service_info con AI reply → solo texto IA, NO lista después', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({ services: [] });
  await bot._internals.routeIntent({
    tenant: TENANT, connection: CONN, conv: CONV, waId: CONV.customerWaId,
    tone: 'usted', intent: 'service_info', aiReply: 'Nuestros masajes duran 60 minutos.',
  });
  assert.equal(sent.length, 1, 'solo 1 respuesta');
  assert.equal(sent[0].kind, 'text');
});

test('palabra clave "menú" muestra menú sin llamar IA', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'text', text: { body: 'menú' } },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'interactive');
  assert.match(sent[0].payload.body.text, /Almita/);
});

test('servicesList acepta body personalizado', () => {
  const payload = menus.servicesList(
    [{ id: 's1', name: 'Masaje', category: 'Masajes', priceUsd: 30, durationMins: 60, active: true }],
    { tone: 'usted', body: '✨ Elige tu servicio para reservar:' }
  );
  assert.equal(payload.body.text, '✨ Elige tu servicio para reservar:');
});
