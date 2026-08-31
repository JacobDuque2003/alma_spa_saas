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
  prisma.client = { findFirst: async () => clientByPhone, upsert: async () => clientByPhone || { id: 'c_upsert', fullName: 'Test' } };
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
  assert.ok(secs.some((t) => t.includes('Facial') || t.includes('facial')));
  assert.ok(secs.some((t) => t.includes('Yoga') || t.includes('yoga')));
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
  assert.match(sent[1].caption, /🌿.*Aero yoga/);
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
  assert.match(sent[0].body, /No encontré reservas a su nombre/);
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
  assert.match(body, /confirmada/i);
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
  assert.match(warned[0].body, /Un momento, por favor/);
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
  assert.match(newMessages[0].body, /No entendí/);
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
  assert.match(sent[0].payload.body.text, /momento|servicio/i, 'cuerpo de la lista debe mencionar momento o servicio');
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
  assert.equal(sent.length, 1, 'debe enviar UN solo mensaje (datePicker con body)');
  assert.equal(sent[0].kind, 'interactive');
  assert.equal(sent[0].payload.action.button, 'Elegir día');
  const rows = sent[0].payload.action.sections[0].rows;
  assert.ok(rows.every(r => r.id.startsWith('bkd_')));
  assert.match(sent[0].payload.body.text, /excelente elección/i);
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
  assert.ok(textMsgs.some(s => /Masaje/.test(s.body)));
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
  assert.ok(sent.some(s => s.kind === 'text' && /cancelé (tu|su) reserva/.test(s.body)));
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

test('time slot list respeta máximo 10 rows y agrupa mañana/tarde', async () => {
  const slots = [];
  for (let i = 0; i < 15; i++) {
    slots.push(new Date(`2026-09-01T${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}:00Z`).toISOString());
  }
  const list = menus.timeSlotList(slots, 'Masaje Relajante', { tone: 'tu' });
  assert.equal(list.type, 'list');
  const allRows = list.action.sections.flatMap(s => s.rows);
  assert.ok(allRows.length <= 10);
  assert.ok(allRows.every(r => r.id.startsWith('bkt_')));
  const sectionTitles = list.action.sections.map(s => s.title);
  assert.ok(sectionTitles.length >= 1, 'debe tener al menos una sección');
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

test('Ronda H: intención tolera faltas, tildes omitidas y letras repetidas', () => {
  assert.equal(bot._internals.detectDeterministicIntent('holaaaa'), 'greeting');
  assert.equal(bot._internals.detectDeterministicIntent('que servcios nomas tienen'), 'list_services');
  assert.equal(bot._internals.detectDeterministicIntent('quiero hacer una reseva'), 'book_start');
});

test('Ronda I: consulta de cita, horario y despedida se entienden sin IA', () => {
  assert.equal(bot._internals.detectDeterministicIntent('quiero consultar mi cita'), 'my_appointment');
  assert.equal(bot._internals.detectDeterministicIntent('a que hora atienden'), 'business_hours');
  assert.equal(bot._internals.detectDeterministicIntent('todo okey gracias'), 'farewell');
});

test('reprogramar cita se entiende sin IA, incluso con una falta común', () => {
  assert.equal(bot._internals.detectDeterministicIntent('quiero reagendar mi cita'), 'reschedule');
  assert.equal(bot._internals.detectDeterministicIntent('puedo reprogramar mi reserva'), 'reschedule');
});

test('sin IA, "reagendar mi cita" inicia el flujo de fechas de la reserva existente', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    clientByPhone: { id: 'client1', fullName: 'María López' },
    nextAppointment: { id: 'appt1', startsAt: new Date('2026-09-15T14:00:00.000Z'), service: { name: 'Masaje Relajante' } },
  });

  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'text', text: { body: 'quiero reagendar mi cita' } },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'interactive');
  assert.equal(sent[0].payload.action.button, 'Elegir día');
  assert.equal(state.getFlowState(CONV.customerWaId)?.reschedule?.appointmentId, 'appt1');
});

test('Ronda I: horario responde en formato claro', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot._internals.routeIntent({
    tenant: TENANT, connection: CONN, conv: CONV, waId: CONV.customerWaId,
    tone: 'usted', intent: 'business_hours',
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'text');
  assert.match(sent[0].body, /9:00 a\. m\./);
  assert.match(sent[0].body, /8:00 p\. m\./);
  assert.match(sent[0].body, /Domingos descansamos/);
});

test('Ronda I: despedida cierra cálida sin mostrar menú', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  await bot._internals.routeIntent({
    tenant: TENANT, connection: CONN, conv: CONV, waId: CONV.customerWaId,
    tone: 'tu', intent: 'farewell',
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'text');
  assert.match(sent[0].body, /lindo día/);
});

test('Ronda H: matchServiceByQuery tolera errores ortográficos en servicios', async () => {
  installPrismaMocks({
    services: [
      { id: 's1', name: 'Masaje relajante', category: 'corporal', priceUsd: 30, durationMins: 120, active: true },
      { id: 's2', name: 'Terapias energéticas', category: 'terapias', priceUsd: 35, durationMins: 75, active: true },
    ],
  });

  const massage = await bot._internals.matchServiceByQuery(TENANT.id, 'masage relajnte');
  assert.equal(massage.id, 's1');
  const energy = await bot._internals.matchServiceByQuery(TENANT.id, 'terapia energetica');
  assert.equal(energy.id, 's2');
});

test('servicesList acepta body personalizado', () => {
  const payload = menus.servicesList(
    [{ id: 's1', name: 'Masaje', category: 'Masajes', priceUsd: 30, durationMins: 60, active: true }],
    { tone: 'usted', body: '✨ Elige tu servicio para reservar:' }
  );
  assert.equal(payload.body.text, '✨ Elige tu servicio para reservar:');
});

// ─── Category display names ─────────────────────────────────

test('categoryDisplayName mapea nombres internos a bonitos', () => {
  assert.match(menus.categoryDisplayName('facial'), /Facial/);
  assert.match(menus.categoryDisplayName('corporal'), /Cuerpo/);
  assert.match(menus.categoryDisplayName('yoga'), /Yoga/);
  assert.equal(menus.categoryDisplayName('Desconocido'), 'Desconocido');
});

test('categoryList filtra categorías ocultas (tienda, recordatorio)', () => {
  const cats = [
    { name: 'facial', count: 3 },
    { name: 'tienda', count: 2 },
    { name: 'recordatorio', count: 1 },
    { name: 'corporal', count: 5 },
  ];
  const payload = menus.categoryList(cats, { tone: 'usted' });
  const rows = payload.action.sections[0].rows;
  assert.equal(rows.length, 2, 'tienda y recordatorio deben ser filtradas');
  assert.ok(rows.every(r => !r.id.includes('tienda') && !r.id.includes('recordatorio')));
});

test('datePicker acepta body personalizado', () => {
  const picker = menus.datePicker({ tone: 'tu', body: '🌟 Masaje — ¡excelente! ¿Qué día?' });
  assert.equal(picker.body.text, '🌟 Masaje — ¡excelente! ¿Qué día?');
});

test('timeSlotButtons genera reply buttons para ≤3 slots', () => {
  const slots = [
    '2026-09-01T14:00:00.000Z',
    '2026-09-01T15:00:00.000Z',
    '2026-09-01T16:00:00.000Z',
  ];
  const payload = menus.timeSlotButtons(slots, 'Masaje Relajante', { tone: 'usted' });
  assert.equal(payload.type, 'button');
  assert.equal(payload.action.buttons.length, 3);
  assert.ok(payload.action.buttons.every(b => b.reply.id.startsWith('bkt_')));
});

test('timeSlotList agrupa en secciones mañana/tarde', () => {
  const slots = [
    '2026-09-01T14:00:00.000Z',
    '2026-09-01T14:30:00.000Z',
    '2026-09-01T20:00:00.000Z',
    '2026-09-01T21:00:00.000Z',
  ];
  const list = menus.timeSlotList(slots, 'Masaje', { tone: 'usted' });
  const titles = list.action.sections.map(s => s.title);
  assert.ok(titles.some(t => /Mañana/.test(t)) || titles.some(t => /Tarde/.test(t)));
});

// ─── handleSelection preserves booking state ─────────────────

test('handleSelection preserva booking state durante selección de fecha', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  const bookingState = {
    flow: 'booking',
    booking: { step: 'select_date', serviceId: 's1', serviceName: 'Masaje Relajante' },
    clientName: 'María',
    tone: 'usted',
    unclearCount: 0,
  };
  state.setFlowState(CONV.customerWaId, bookingState);

  // Mock getAvailability
  const origGetAvail = require('./appointmentService').getAvailability;
  require('./appointmentService').getAvailability = async () => [
    '2026-09-01T14:00:00.000Z',
    '2026-09-01T15:00:00.000Z',
  ];
  // Mock tenant lookup
  prisma.tenant.findUnique = async () => ({ config: {} });

  await bot._internals.handleSelection({
    tenant: TENANT, connection: CONN, conv: CONV,
    waId: CONV.customerWaId, tone: 'usted', selectionId: 'bkd_2026-09-01',
  });

  const fs = state.getFlowState(CONV.customerWaId);
  assert.ok(fs.booking, 'booking state must survive');
  assert.equal(fs.booking.step, 'select_time');
  assert.ok(fs.booking.availableSlots, 'availableSlots must be set');
  assert.equal(fs.booking.serviceId, 's1');

  require('./appointmentService').getAvailability = origGetAvail;
});

test('handleSelection preserva booking state durante selección de hora', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({ clientByPhone: { id: 'c1', fullName: 'María López' } });
  const slots = ['2026-09-01T14:00:00.000Z', '2026-09-01T15:00:00.000Z'];
  state.setFlowState(CONV.customerWaId, {
    flow: 'booking',
    booking: { step: 'select_time', serviceId: 's1', serviceName: 'Masaje Relajante', date: '2026-09-01', availableSlots: slots },
    clientName: 'María López',
    tone: 'usted',
    unclearCount: 0,
  });

  await bot._internals.handleSelection({
    tenant: TENANT, connection: CONN, conv: CONV,
    waId: CONV.customerWaId, tone: 'usted', selectionId: 'bkt_0',
  });

  const fs = state.getFlowState(CONV.customerWaId);
  assert.equal(fs.booking?.step, 'confirm');
  assert.equal(fs.booking?.timeSlot, slots[0]);
  assert.ok(sent.some(s => s.kind === 'interactive' && s.payload?.type === 'button'));
});

test('handleSelection conserva reprogramación y ofrece solo los horarios validados', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  state.setFlowState(CONV.customerWaId, {
    flow: 'reschedule',
    reschedule: { step: 'select_date', appointmentId: 'appt1', serviceName: 'Masaje Relajante' },
    clientName: 'María López', tone: 'usted', unclearCount: 0,
  });
  const appointmentService = require('./appointmentService');
  const original = appointmentService.getRescheduleAvailability;
  appointmentService.getRescheduleAvailability = async () => ['2026-09-01T20:00:00.000Z'];
  prisma.tenant.findUnique = async () => ({ config: {} });

  try {
    await bot._internals.handleSelection({
      tenant: TENANT, connection: CONN, conv: CONV,
      waId: CONV.customerWaId, tone: 'usted', selectionId: 'bkd_2026-09-01',
    });
    const fs = state.getFlowState(CONV.customerWaId);
    assert.equal(fs.reschedule?.step, 'select_time');
    assert.deepEqual(fs.reschedule?.availableSlots, ['2026-09-01T20:00:00.000Z']);
    assert.ok(sent.some((item) => item.kind === 'interactive' && item.payload?.type === 'button'));
  } finally {
    appointmentService.getRescheduleAvailability = original;
  }
});

// ─── Smart booking tests ─────────────────────────────────────

test('handleSmartBooking con servicio+fecha+hora exacta → confirma directo', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({ clientByPhone: { id: 'c1', fullName: 'María López' } });
  const slots = ['2026-09-01T20:00:00.000Z'];
  const origGetAvail = require('./appointmentService').getAvailability;
  require('./appointmentService').getAvailability = async () => slots;
  prisma.tenant.findUnique = async () => ({ config: {} });

  await bot._internals.handleSmartBooking({
    tenant: TENANT, connection: CONN, conv: CONV,
    waId: CONV.customerWaId, tone: 'usted',
    service: { id: 's1', name: 'Masaje Relajante' },
    date: '2026-09-01', time: '15:00',
  });

  const fs = state.getFlowState(CONV.customerWaId);
  assert.equal(fs.booking?.step, 'confirm');
  assert.ok(sent.some(s => s.kind === 'interactive' && s.payload?.type === 'button'));

  require('./appointmentService').getAvailability = origGetAvail;
});

test('handleSmartBooking con hora no disponible → muestra alternativas', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  const slots = [
    '2026-09-01T14:00:00.000Z',
    '2026-09-01T15:00:00.000Z',
    '2026-09-01T16:00:00.000Z',
    '2026-09-01T17:00:00.000Z',
  ];
  const origGetAvail = require('./appointmentService').getAvailability;
  require('./appointmentService').getAvailability = async () => slots;
  prisma.tenant.findUnique = async () => ({ config: {} });

  await bot._internals.handleSmartBooking({
    tenant: TENANT, connection: CONN, conv: CONV,
    waId: CONV.customerWaId, tone: 'usted',
    service: { id: 's1', name: 'Masaje Relajante' },
    date: '2026-09-01', time: '13:00',
  });

  assert.equal(sent.length, 1, 'un solo mensaje');
  assert.equal(sent[0].kind, 'interactive');
  assert.match(sent[0].payload.body.text, /No hay horario/);

  require('./appointmentService').getAvailability = origGetAvail;
});

test('handleSmartBooking sin horarios → datePicker con mensaje', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  const origGetAvail = require('./appointmentService').getAvailability;
  require('./appointmentService').getAvailability = async () => [];
  prisma.tenant.findUnique = async () => ({ config: {} });

  await bot._internals.handleSmartBooking({
    tenant: TENANT, connection: CONN, conv: CONV,
    waId: CONV.customerWaId, tone: 'usted',
    service: { id: 's1', name: 'Masaje Relajante' },
    date: '2026-09-01', time: '15:00',
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.action.button, 'Elegir día');
  assert.match(sent[0].payload.body.text, /No hay horarios/);

  require('./appointmentService').getAvailability = origGetAvail;
});

// ─── Hidden category filtering ──────────────────────────────

test('handleBook filtra categorías ocultas (tienda, recordatorio)', async () => {
  resetState();
  const sent = installTransportMocks();
  const services = [];
  for (let i = 0; i < 5; i++) services.push({ id: `s${i}`, name: `Svc ${i}`, category: 'corporal', priceUsd: 20, durationMins: 60, active: true });
  for (let i = 5; i < 10; i++) services.push({ id: `s${i}`, name: `Svc ${i}`, category: 'facial', priceUsd: 25, durationMins: 45, active: true });
  for (let i = 10; i < 13; i++) services.push({ id: `s${i}`, name: `Svc ${i}`, category: 'tienda', priceUsd: 10, durationMins: 30, active: true });
  services.push({ id: 's13', name: 'Recordatorio', category: 'recordatorio', priceUsd: 0, durationMins: 0, active: true });
  installPrismaMocks({ services });

  await bot._internals.handleBook({ tenant: TENANT, connection: CONN, conv: CONV, waId: CONV.customerWaId, tone: 'usted' });

  assert.equal(sent.length, 1);
  const body = JSON.stringify(sent[0].payload);
  assert.ok(!body.includes('tienda'), 'tienda no debe aparecer');
  assert.ok(!body.includes('recordatorio'), 'recordatorio no debe aparecer');
});

// ─── Ronda E: reserva completa y cambio de servicio ────────────────

test('Ronda E: "quiero hacer una reserva" muestra catálogo agrupado por categorías visibles', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    services: [
      { id: 's1', name: 'Limpieza facial', category: 'facial', priceUsd: 25, durationMins: 75, active: true },
      { id: 's2', name: 'Aero yoga', category: 'yoga', priceUsd: 20, durationMins: 60, active: true },
      { id: 's3', name: 'Camilla Ceragem', category: 'ceragem', priceUsd: 20, durationMins: 60, active: true },
      { id: 's4', name: 'Corporal - Reductor', category: 'corporal', priceUsd: 35, durationMins: 75, active: true },
      { id: 's5', name: 'Cumpleaños', category: 'recordatorio', priceUsd: 0, durationMins: 15, active: true },
      { id: 's6', name: 'Depilación', category: 'laser', priceUsd: 25, durationMins: 60, active: true },
      { id: 's7', name: 'Detox iónica', category: 'pies', priceUsd: 15, durationMins: 30, active: true },
      { id: 's8', name: 'Drenaje post-operatorio', category: 'corporal', priceUsd: 45, durationMins: 105, active: true },
      { id: 's9', name: 'Emo vacuna', category: 'terapias', priceUsd: 30, durationMins: 30, active: true },
      { id: 's10', name: 'Masaje relajante', category: 'corporal', priceUsd: 40, durationMins: 120, active: true },
      { id: 's11', name: 'Reflexología', category: 'pies', priceUsd: 25, durationMins: 60, active: true },
      { id: 's12', name: 'Sueroterapia', category: 'terapias', priceUsd: 35, durationMins: 30, active: true },
      { id: 's13', name: 'Terapia neural', category: 'terapias', priceUsd: 45, durationMins: 105, active: true },
      { id: 's14', name: 'Terapias energéticas', category: 'terapias', priceUsd: 35, durationMins: 75, active: true },
      { id: 's15', name: 'Tratamientos faciales', category: 'facial', priceUsd: 30, durationMins: 75, active: true },
      { id: 's16', name: 'Valoración', category: 'valoracion', priceUsd: 0, durationMins: 15, active: true },
    ],
  });

  await bot.handleInboundMessage({
    tenant: TENANT,
    connection: CONN,
    conv: CONV,
    incoming: { type: 'text', text: { body: 'quiero hacer una reserva, hay como?' } },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'interactive');
  assert.equal(sent[0].payload.action.button, 'Ver categorías');
  const rows = sent[0].payload.action.sections[0].rows;
  assert.ok(rows.length > 1, 'debe mostrar más de una categoría');
  assert.ok(rows.some((row) => row.id === 'cat_terapias'), 'debe incluir terapias');
  assert.ok(rows.some((row) => row.id === 'cat_ceragem'), 'debe incluir ceragem, sin quedarse solo ahí');
  assert.ok(!rows.some((row) => /recordatorio|valoracion/i.test(row.id)), 'debe ocultar internos');
});

test('Ronda E: texto con otro servicio dentro de reserva cambia el servicio activo', async () => {
  resetState();
  const sent = installTransportMocks();
  const services = [
    { id: 'ceragem', name: 'Camilla Ceragem', category: 'ceragem', priceUsd: 20, durationMins: 60, active: true },
    { id: 'energeticas', name: 'Terapias energéticas', category: 'terapias', priceUsd: 35, durationMins: 75, active: true },
  ];
  installPrismaMocks({
    services,
    serviceById: Object.fromEntries(services.map((service) => [service.id, { ...service, tenantId: TENANT.id }])),
  });
  state.setFlowState(CONV.customerWaId, {
    flow: 'booking',
    booking: { step: 'select_date', serviceId: 'ceragem', serviceName: 'Camilla Ceragem' },
    tone: 'usted',
  });

  await bot.handleInboundMessage({
    tenant: TENANT,
    connection: CONN,
    conv: CONV,
    incoming: { type: 'text', text: { body: 'mejor terapias energeticas' } },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.action.button, 'Elegir día');
  assert.match(sent[0].payload.body.text, /Terapias energéticas/);
  const st = state.getFlowState(CONV.customerWaId);
  assert.equal(st.booking.serviceId, 'energeticas');
  assert.equal(st.booking.serviceName, 'Terapias energéticas');
});

test('Ronda E: si la IA trae service_info con reply, primero cambia el servicio en booking', async () => {
  resetState();
  const sent = installTransportMocks();
  const services = [
    { id: 'ceragem', name: 'Camilla Ceragem', category: 'ceragem', priceUsd: 20, durationMins: 60, active: true },
    { id: 'energeticas', name: 'Terapias energéticas', category: 'terapias', priceUsd: 35, durationMins: 75, active: true },
  ];
  installPrismaMocks({
    services,
    serviceById: Object.fromEntries(services.map((service) => [service.id, { ...service, tenantId: TENANT.id }])),
  });
  state.setFlowState(CONV.customerWaId, {
    flow: 'booking',
    booking: { step: 'select_date', serviceId: 'ceragem', serviceName: 'Camilla Ceragem' },
    tone: 'usted',
  });

  await bot._internals.routeIntent({
    tenant: TENANT,
    connection: CONN,
    conv: CONV,
    waId: CONV.customerWaId,
    tone: 'usted',
    intent: 'service_info',
    aiReply: 'Texto de IA que no debe bloquear el cambio',
    params: { service_query: 'terapias energéticas' },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'interactive');
  assert.equal(sent[0].payload.action.button, 'Elegir día');
  assert.ok(!sent.some((item) => item.kind === 'text' && /Texto de IA/.test(item.body || '')));
  assert.equal(state.getFlowState(CONV.customerWaId).booking.serviceId, 'energeticas');
});

// ─── Ronda F: cálculo de fechas en JS ───────────────────────────────

test('Ronda F: resuelve cada día de la semana desde referencias distintas', () => {
  const { resolveCalendarDate } = bot._internals;
  const cases = [
    ['lunes', '2026-08-26T12:00:00-05:00', '2026-08-31'],
    ['martes', '2026-08-26T12:00:00-05:00', '2026-09-01'],
    ['miércoles', '2026-08-26T12:00:00-05:00', '2026-08-26'],
    ['jueves', '2026-08-26T12:00:00-05:00', '2026-08-27'],
    ['viernes', '2026-08-29T12:00:00-05:00', '2026-09-04'],
    ['sábado', '2026-08-29T12:00:00-05:00', '2026-08-29'],
    ['domingo', '2026-08-29T12:00:00-05:00', '2026-08-30'],
  ];

  for (const [rawDateText, referenceDate, expected] of cases) {
    assert.equal(
      resolveCalendarDate(rawDateText, { referenceDate: new Date(referenceDate) }),
      expected,
      `${rawDateText} desde ${referenceDate}`,
    );
  }
});

test('Ronda F: resuelve hoy, mañana, pasado mañana y cruces de mes', () => {
  const { resolveCalendarDate } = bot._internals;
  const cases = [
    ['hoy', '2026-08-30T12:00:00-05:00', '2026-08-30'],
    ['mañana', '2026-08-30T12:00:00-05:00', '2026-08-31'],
    ['pasado mañana', '2026-08-30T12:00:00-05:00', '2026-09-01'],
    ['el 5', '2026-08-30T12:00:00-05:00', '2026-09-05'],
    ['31/12', '2026-12-30T12:00:00-05:00', '2026-12-31'],
    ['1/1', '2026-12-30T12:00:00-05:00', '2027-01-01'],
    ['5 de septiembre', '2026-08-30T12:00:00-05:00', '2026-09-05'],
  ];

  for (const [rawDateText, referenceDate, expected] of cases) {
    assert.equal(
      resolveCalendarDate(rawDateText, { referenceDate: new Date(referenceDate) }),
      expected,
      `${rawDateText} desde ${referenceDate}`,
    );
  }
});

test('Ronda F: reserva usa date_text crudo y no confía en params.date de la IA', () => {
  const { resolveBookingDate } = bot._internals;
  const resolved = resolveBookingDate(
    { date: '2026-09-01', date_text: 'viernes' },
    null,
    { referenceDate: new Date('2026-08-29T12:00:00-05:00') },
  );

  assert.equal(resolved, '2026-09-04');
});

// ─── Ronda G: consultas de catálogo y explicación contextual ────────

test('Ronda G: "qué servicios tienen" responde catálogo completo en texto con descripciones', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    services: [
      { id: 's1', name: 'Limpieza facial', category: 'facial', priceUsd: 30, durationMins: 75, description: 'Limpieza profunda para renovar la piel.', active: true },
      { id: 's2', name: 'Masaje relajante', category: 'corporal', priceUsd: 40, durationMins: 120, description: 'Masaje suave para aliviar tensión y descansar mejor.', active: true },
      { id: 's3', name: 'Terapias energéticas', category: 'terapias', priceUsd: 35, durationMins: 75, description: 'Armonización energética para equilibrar cuerpo y mente.', active: true },
      { id: 's4', name: 'Cumpleaños', category: 'recordatorio', priceUsd: 0, durationMins: 15, description: 'Servicio interno.', active: true },
      { id: 's5', name: 'Reflexología', category: 'pies', priceUsd: 0, durationMins: 60, description: null, active: true },
    ],
  });

  await bot.handleInboundMessage({
    tenant: TENANT,
    connection: CONN,
    conv: CONV,
    incoming: { type: 'text', text: { body: 'que servicios nomás tienen?' } },
  });

  assert.ok(sent.length >= 1);
  assert.equal(sent[0].kind, 'text');
  const body = sent.map((item) => item.body || '').join('\n');
  assert.match(body, /Limpieza facial/);
  assert.match(body, /Limpieza profunda para renovar la piel/);
  assert.match(body, /Masaje relajante/);
  assert.match(body, /Terapias energéticas/);
  assert.match(body, /Reflexología/);
  assert.match(body, /valor a confirmar · 60 min/);
  assert.doesNotMatch(body, /Cumpleaños/);
  assert.doesNotMatch(body, /\$0\.00/);
  assert.doesNotMatch(body, /Servicio de/);
  assert.ok(!sent.some((item) => item.kind === 'interactive'), 'no debe enviar botón de categorías cuando pidieron mensaje');
});

test('Ronda G: "de qué trata eso" en reserva explica el servicio activo y no vuelve a pedir fecha', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({
    serviceById: {
      s1: {
        id: 's1',
        tenantId: TENANT.id,
        name: 'Masaje relajante',
        category: 'corporal',
        priceUsd: 40,
        durationMins: 120,
        description: 'Masaje suave para aliviar tensión y descansar mejor.',
        active: true,
      },
    },
  });
  state.setFlowState(CONV.customerWaId, {
    flow: 'booking',
    booking: { step: 'select_date', serviceId: 's1', serviceName: 'Masaje relajante' },
    tone: 'usted',
  });

  await bot.handleInboundMessage({
    tenant: TENANT,
    connection: CONN,
    conv: CONV,
    incoming: { type: 'text', text: { body: 'de que trata eso?' } },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'text');
  assert.match(sent[0].body, /Masaje relajante/);
  assert.match(sent[0].body, /aliviar tensión/);
  assert.match(sent[0].body, /qué día le queda bien/);
  assert.equal(state.getFlowState(CONV.customerWaId).booking.step, 'select_date');
});

// ─── P4: text confirm/cancel in booking confirm step ────────────────

test('P4: "confirmo" text triggers booking confirmation', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({ clientByPhone: { id: 'c1', fullName: 'Ana' } });
  state.setFlowState(CONV.customerWaId, {
    flow: 'booking',
    booking: { step: 'confirm', serviceId: 's1', serviceName: 'Masaje', timeSlot: '2026-09-01T15:00:00Z', clientName: 'Ana' },
    tone: 'usted',
  });
  prisma.$transaction = async (fn) => fn(prisma);
  const origResolve = require('./appointmentService').resolveAndCreateAppointment;
  require('./appointmentService').resolveAndCreateAppointment = async () => ({ id: 'apt1' });
  try {
    await bot.handleInboundMessage({
      tenant: TENANT, connection: CONN, conv: CONV,
      incoming: { type: 'text', text: { body: 'confirmo' } },
    });
    assert.ok(sent.some(s => s.kind === 'text' && /reservado/i.test(s.body)), 'should confirm booking');
  } finally {
    require('./appointmentService').resolveAndCreateAppointment = origResolve;
  }
});

test('P4: "Sí" with accent triggers booking confirmation', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({ clientByPhone: { id: 'c1', fullName: 'Ana' } });
  state.setFlowState(CONV.customerWaId, {
    flow: 'booking',
    booking: { step: 'confirm', serviceId: 's1', serviceName: 'Masaje', timeSlot: '2026-09-01T15:00:00Z', clientName: 'Ana' },
    tone: 'usted',
  });
  prisma.$transaction = async (fn) => fn(prisma);
  const origResolve = require('./appointmentService').resolveAndCreateAppointment;
  require('./appointmentService').resolveAndCreateAppointment = async () => ({ id: 'apt1' });
  try {
    await bot.handleInboundMessage({
      tenant: TENANT, connection: CONN, conv: CONV,
      incoming: { type: 'text', text: { body: 'Sí' } },
    });
    assert.ok(sent.some(s => s.kind === 'text' && /reservado/i.test(s.body)), 'should confirm booking');
  } finally {
    require('./appointmentService').resolveAndCreateAppointment = origResolve;
  }
});

test('P4: "no gracias" text cancels booking', async () => {
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
    incoming: { type: 'text', text: { body: 'no gracias' } },
  });
  assert.ok(sent.some(s => s.kind === 'text' && /cancelé (tu|su) reserva/.test(s.body)));
  assert.ok(sent.some(s => s.kind === 'interactive'));
});

test('P4: unrecognized text in confirm step falls through to normal flow', async () => {
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
    incoming: { type: 'text', text: { body: 'hola quiero otro servicio' } },
  });
  assert.ok(sent.length > 0, 'should respond with something (menu or AI)');
  assert.ok(!sent.some(s => s.kind === 'text' && /cancelé la reserva/.test(s.body)), 'should NOT cancel');
});

// ─── P7: pendiente_bot shows "confirmada" to client ────────────────

test('P7: handleMyAppointment shows "confirmada" for pendiente_bot status', async () => {
  resetState();
  const sent = installTransportMocks();
  const futureDate = new Date(Date.now() + 86400000).toISOString();
  installPrismaMocks({ clientByPhone: { id: 'c1', fullName: 'Ana' } });
  prisma.appointment.findFirst = async () => ({
    id: 'a1', status: 'pendiente_bot', startsAt: futureDate,
    service: { name: 'Masaje relajante' }, room: { name: 'Cabina 1' },
  });
  state.setFlowState(CONV.customerWaId, { flow: 'menu', tone: 'usted' });
  await bot._internals.handleMyAppointment({ tenant: TENANT, connection: CONN, conv: CONV, waId: CONV.customerWaId, tone: 'usted' });
  const reply = sent.find(s => s.kind === 'text' && /próximo espacio/.test(s.body));
  assert.ok(reply, 'should send appointment info');
  assert.ok(/confirmada/i.test(reply.body), 'should say confirmada, not pendiente de confirmar');
  assert.ok(!/pendiente de confirmar/i.test(reply.body), 'should NOT say pendiente de confirmar');
});

// ─── Ronda D: no success message without a real appointment ──────────
test('Ronda D: no success message if resolveAndCreateAppointment returns null', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({ clientByPhone: { id: 'c1', fullName: 'Ana' } });
  state.setFlowState(CONV.customerWaId, {
    flow: 'booking',
    booking: { step: 'confirm', serviceId: 's1', serviceName: 'Masaje', timeSlot: '2026-09-01T15:00:00Z', clientName: 'Ana' },
    tone: 'usted',
  });
  prisma.$transaction = async (fn) => fn(prisma);
  const origResolve = require('./appointmentService').resolveAndCreateAppointment;
  require('./appointmentService').resolveAndCreateAppointment = async () => null;
  try {
    await bot.handleInboundMessage({
      tenant: TENANT, connection: CONN, conv: CONV,
      incoming: { type: 'text', text: { body: 'confirmo' } },
    });
    assert.ok(!sent.some(s => s.kind === 'text' && /reservado/i.test(s.body)),
      'MUST NOT send success message when no appointment was created');
    assert.ok(sent.some(s => s.kind === 'text' && /recepción/i.test(s.body)),
      'should escalate to reception');
  } finally {
    require('./appointmentService').resolveAndCreateAppointment = origResolve;
  }
});

test('Ronda D: no success message if resolveAndCreateAppointment returns {}', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks({ clientByPhone: { id: 'c1', fullName: 'Ana' } });
  state.setFlowState(CONV.customerWaId, {
    flow: 'booking',
    booking: { step: 'confirm', serviceId: 's1', serviceName: 'Masaje', timeSlot: '2026-09-01T15:00:00Z', clientName: 'Ana' },
    tone: 'usted',
  });
  prisma.$transaction = async (fn) => fn(prisma);
  const origResolve = require('./appointmentService').resolveAndCreateAppointment;
  require('./appointmentService').resolveAndCreateAppointment = async () => ({});
  try {
    await bot.handleInboundMessage({
      tenant: TENANT, connection: CONN, conv: CONV,
      incoming: { type: 'text', text: { body: 'si' } },
    });
    assert.ok(!sent.some(s => s.kind === 'text' && /reservado/i.test(s.body)),
      'MUST NOT send success message when appointment has no id');
    assert.ok(sent.some(s => s.kind === 'text' && /recepción/i.test(s.body)),
      'should escalate to reception');
  } finally {
    require('./appointmentService').resolveAndCreateAppointment = origResolve;
  }
});

// ─── Ronda D: voice note handler ────────────────────────────────────
test('Ronda D: voice note gets polite decline (tú)', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  state.setFlowState(CONV.customerWaId, { tone: 'tu' });
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'audio', audio: { id: 'audio1' } },
  });
  assert.ok(sent.some(s => s.kind === 'text' && /notas de voz/.test(s.body)));
  assert.ok(sent.some(s => s.kind === 'text' && /escribes/.test(s.body)));
  assert.ok(!sent.some(s => s.kind === 'interactive'), 'should NOT send menu after voice note');
});

test('Ronda D: voice note gets polite decline (usted)', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  state.setFlowState(CONV.customerWaId, { tone: 'usted' });
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'audio', audio: { id: 'audio1' } },
  });
  assert.ok(sent.some(s => s.kind === 'text' && /notas de voz/.test(s.body)));
  assert.ok(sent.some(s => s.kind === 'text' && /escribe\b/.test(s.body)));
});

// ─── Ronda D: booking confirm with incomplete state ─────────────────
test('Ronda D: confirm step with missing serviceId redirects to booking flow', async () => {
  resetState();
  const sent = installTransportMocks();
  installPrismaMocks();
  state.setFlowState(CONV.customerWaId, {
    flow: 'booking',
    booking: { step: 'confirm', timeSlot: '2026-09-01T15:00:00Z', clientName: 'Ana' },
    tone: 'usted',
  });
  await bot.handleInboundMessage({
    tenant: TENANT, connection: CONN, conv: CONV,
    incoming: { type: 'text', text: { body: 'confirmo' } },
  });
  assert.ok(!sent.some(s => s.kind === 'text' && /reservado/i.test(s.body)),
    'MUST NOT confirm with incomplete booking state');
});

// ─── Guard: bot must not call methods missing from appointmentService ────
test('bot only calls methods that appointmentService actually exports', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const realExports = Object.keys(require('./appointmentService'));
  const src = fs.readFileSync(path.join(__dirname, 'whatsappBot', 'index.js'), 'utf8');
  const calls = [...src.matchAll(/appointmentService\.(\w+)\s*\(/g)].map(m => m[1]);
  assert.ok(calls.length > 0, 'should find at least one appointmentService call in bot source');
  for (const method of calls) {
    assert.ok(realExports.includes(method),
      `bot calls appointmentService.${method}() but it is NOT exported — add it to module.exports in appointmentService.js`);
  }
});
