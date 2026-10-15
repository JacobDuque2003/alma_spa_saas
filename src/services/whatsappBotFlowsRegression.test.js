const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
function mock(file, exports) {
  const id = require.resolve(file);
  const instance = new Module(id);
  instance.exports = exports;
  instance.loaded = true;
  require.cache[id] = instance;
  return exports;
}
const prisma = mock('../utils/prisma', {});
const transport = mock('./whatsappTransport', {});
const ai = mock('./aiClient', {});
const center = mock('./almitaCenterService', {});
const appointments = mock('./appointmentService', {});
const serviceApi = mock('./serviceService', {});
mock('./clientService', {});
mock('./conversationMemoryService', { loadConversationHistory: async () => [] });
mock('./crmEventBus', { publish: () => {} });
const bot = require('./whatsappBot');
const state = require('./whatsappBot/state');
const rateLimit = require('./whatsappBot/rateLimit');
const tenant = { id: 'synthetic-tenant', slug: 'alma-spa', config: { workDays: [1, 2, 3, 4, 5, 6, 0], businessHours: { start: '00:00', end: '23:59' } } };
const conv = { id: 'synthetic-conv', tenantId: tenant.id, customerWaId: '593999000001', clientId: 'synthetic-client', labels: [] };
const connection = { tenantId: tenant.id };
const massage = { id: 'massage', tenantId: tenant.id, name: 'Masaje relajante', category: 'masajes', active: true, priceUsd: 30, durationMins: 60, description: 'Descripcion aprobada. No sustituye atencion medica.' };
let sent, services, knowledge, client, upcoming, aiCalls, cancelCalls;
beforeEach(() => {
  state._reset(); rateLimit._reset();
  sent = []; services = [massage]; knowledge = []; client = null; upcoming = []; aiCalls = 0; cancelCalls = 0;
  transport.sendText = async (_connection, _to, body) => { sent.push(body); return { ok: true, data: { messages: [{ id: 'synthetic-message' }] } }; };
  transport.sanitizeError = () => ({ message: 'synthetic' });
  prisma.whatsAppMessage = { create: async () => ({}) };
  prisma.whatsAppConversation = { update: async () => ({}) };
  prisma.client = { findFirst: async () => client };
  prisma.appointment = { findMany: async () => upcoming };
  prisma.service = { findMany: async () => services, findUnique: async ({ where }) => services.find((row) => row.id === where.id) };
  prisma.tenant = { findUnique: async () => ({ config: tenant.config }) };
  prisma.botInteractionLog = { create: async () => ({}), aggregate: async () => ({ _sum: { costUsd: 0 } }) };
  prisma.$transaction = async (fn) => fn(prisma);
  center.loadRuntimeContext = async () => ({ configuration: null, knowledge, examples: [] });
  ai.isAvailable = () => false;
  ai.chat = async () => { aiCalls++; throw new Error('Unexpected provider call'); };
  serviceApi.getService = async (_actor, id) => services.find((row) => row.id === id);
  serviceApi.getServiceImage = async () => null;
  appointments.cancelWhatsAppAppointment = async () => { cancelCalls++; return { id: 'appointment' }; };
});
function scoped(callback) { return state.withConversation(tenant.id, conv.id, callback); }
function inbound(body) { return bot.handleInboundMessage({ tenant, connection, conv, incoming: { type: 'text', text: { body } } }); }

function installBookingCompletion() {
  const { DateTime } = require('luxon');
  client = { id: 'synthetic-client', tenantId: tenant.id, fullName: 'Ana Prueba' };
  prisma.appointment.findFirst = async () => null;
  const slot = DateTime.now().setZone('America/Guayaquil').plus({ days: 1 }).set({ hour: 16, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO();
  appointments.getAvailability = async () => [slot];
  appointments.getAvailableStaffForSlot = async () => [{ id: 'therapist', name: 'Terapeuta' }];
  appointments.resolveAndCreateAppointment = async () => ({ id: 'real-synthetic-appointment' });
  require('./clientService').upsertClient = async () => client;
  transport.sendInteractive = async (_connection, _to, payload) => { sent.push(payload.body.text); return { ok: true, data: { messages: [{ id: 'synthetic-interactive' }] }, interactivePayload: payload }; };
}

test('registered client completes normal booking in four bot messages and thanks needs no reply', async () => {
  installBookingCompletion();
  for (const message of ['quiero reservar masaje relajante', 'mañana', 'a las 4', 'confirmo']) {
    const before = sent.length;
    await inbound(message);
    assert.equal(sent.length - before, 1);
  }
  assert.equal(sent.length, 4);
  assert.match(sent.at(-1), /reservado/);
  await inbound('gracias');
  assert.equal(sent.length, 4);
});

test('complete shorthand booking takes only summary and real appointment confirmation', async () => {
  installBookingCompletion();
  await inbound('kiero masaje relajante mañana a las 4');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Confirmo|confirmar/);
  await inbound('confirmo');
  assert.equal(sent.length, 2);
  assert.match(sent[1], /reservado/);
});

test('required public warnings must be delivered before booking can advance', async () => {
  installBookingCompletion();
  services = [{ ...massage, description: 'Texto aprobado. '.repeat(500) + 'ADVERTENCIA_FINAL' }];
  await inbound('cuanto cuesta masaje relajante');
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0], /ADVERTENCIA_FINAL/);
  await inbound('quiero reservar este servicio');
  scoped(() => assert.equal(state.getFlowState(conv.customerWaId).booking, undefined));
  for (let count = 0; count < 10; count++) {
    const pending = await scoped(() => state.getFlowState(conv.customerWaId)?.pendingBotPages?.length);
    if (!pending) break;
    await inbound('continuar');
  }
  assert.match(sent.join('\n'), /ADVERTENCIA_FINAL/);
});

test('a failed first delivery cannot bypass warnings or create an appointment', async () => {
  installBookingCompletion();
  services = [{ ...massage, description: 'Texto aprobado. '.repeat(500) + 'ADVERTENCIA_FINAL' }];
  let created = 0, fail = true;
  appointments.resolveAndCreateAppointment = async () => { created++; return { id: 'must-not-be-created' }; };
  const originalSend = transport.sendText;
  transport.sendText = async (...args) => {
    if (fail) { fail = false; return { ok: false, status: 503 }; }
    return originalSend(...args);
  };
  await inbound('quiero reservar masaje relajante');
  for (const message of ['mañana', 'a las 4', 'confirmo']) await inbound(message);
  assert.equal(created, 0);
  assert.match(sent.join('\n'), /ADVERTENCIA_FINAL/);
});

test('combined name, ID and address are profile data rather than a location request', async () => {
  installBookingCompletion();
  const { DateTime } = require('luxon');
  await scoped(() => state.setFlowState(conv.customerWaId, { flow: 'booking', booking: {
    step: 'ask_profile', serviceId: massage.id, serviceName: massage.name,
    timeSlot: DateTime.now().plus({ days: 1 }).toISO(), staffId: 'therapist',
  } }));
  await inbound('Nombre: Ana Prueba\nCedula: 0000000000\nDireccion: Calle Fixture');
  scoped(() => {
    const booking = state.getFlowState(conv.customerWaId).booking;
    assert.equal(booking.step, 'confirm');
    assert.equal(booking.clientName, 'Ana Prueba');
    assert.equal(booking.address, 'Calle Fixture');
  });
});

test('modalidad informativa no reserva el servicio base y respuestas repetidas no gastan IA', async () => {
  services = [{ ...massage, name: 'Limpieza facial' }];
  knowledge = [{ title: 'Limpieza facial kids', content: 'Cuidado infantil aprobado.', active: true, audience: 'PUBLIC' }];
  for (let i = 0; i < 2; i++) await inbound('quiero reservar limpieza facial kids');
  assert.equal(aiCalls, 0);
  assert.equal(sent.length, 2);
  assert.ok(sent.every((body) => /Cuidado infantil/.test(body) && /asesor/.test(body)));
  scoped(() => assert.equal(state.getFlowState(conv.customerWaId)?.booking, undefined));
});

test('modalidad inexistente y nombre ambiguo no se sustituyen silenciosamente', async () => {
  services = [{ ...massage, name: 'Limpieza facial' }];
  assert.equal(await bot._internals.matchServiceByQuery(tenant.id, 'limpieza facial profunda'), null);
  services = [{ ...massage, name: 'Masaje con bambu' }, { ...massage, id: 'stone', name: 'Masaje con piedras calientes' }];
  assert.equal(await bot._internals.matchServiceByQuery(tenant.id, 'masaje'), null);
});

test('la IA tampoco puede sustituir una modalidad no configurada por la ficha base', async () => {
  services = [{ ...massage, name: 'Limpieza facial' }];
  await scoped(async () => {
    await bot._internals.routeIntent({ tenant, connection, conv, waId: conv.customerWaId, tone: 'tu',
      intent: 'book_service', params: { service_query: 'Limpieza facial' }, userMessage: 'quiero reservar limpieza facial kids' });
    assert.equal(state.getFlowState(conv.customerWaId).booking.step, 'select_service');
    assert.equal(state.getFlowState(conv.customerWaId).booking.serviceId, undefined);
  });
  assert.match(sent[0], /tratamiento exacto/);
  assert.doesNotMatch(sent[0], /qué día/);
});

test('preguntar otro tratamiento no cambia la reserva ni solicita su fecha', async () => {
  services.push({ ...massage, id: 'facial', name: 'Limpieza facial', description: 'Cuidado aprobado del rostro.' });
  await scoped(async () => {
    state.setFlowState(conv.customerWaId, { flow: 'booking', booking: { step: 'select_date', serviceId: massage.id, serviceName: massage.name } });
    await inbound('que es limpieza facial');
    assert.equal(state.getFlowState(conv.customerWaId).booking.serviceId, massage.id);
  });
  assert.match(sent[0], /Cuidado aprobado del rostro/);
  assert.match(sent[0], /no cambia la reserva/);
  assert.doesNotMatch(sent[0], /qué día/i);
});

test('preguntas concretas usan ficha operativa sin IA ni respuesta antigua', async () => {
  for (let i = 0; i < 2; i++) await inbound('cuanto cuesta masaje relajante');
  assert.equal(aiCalls, 0);
  assert.ok(sent.some((body) => body.includes('$30.00')));
  services = [{ ...massage, priceUsd: 35 }];
  await inbound('cuanto cuesta masaje relajante');
  assert.ok(sent.at(-1).includes('$35.00'));
});

test('pedir asesor no se captura como nombre, direccion o cedula', async () => {
  for (const step of ['ask_name', 'ask_address', 'ask_cedula']) {
    state._reset(); rateLimit._reset(); sent = [];
    await scoped(async () => {
      state.setFlowState(conv.customerWaId, { flow: 'booking', booking: { step, serviceId: massage.id } });
      await inbound('quiero hablar con un asesor');
      assert.equal(state.getFlowState(conv.customerWaId), null);
    });
    assert.match(sent[0], /conecto con un asesor/);
    assert.ok(sent.every((body) => !/cédula|dirección/.test(body)));
  }
});

test('precio pendiente no inicia reserva automatica ni se presenta gratuito', async () => {
  services = [{ ...massage, priceUsd: 0 }];
  await inbound('quiero reservar masaje relajante');
  assert.match(sent.join('\n'), /Valor a confirmar/);
  assert.doesNotMatch(sent.join('\n'), /gratis|\$0\.00|qué día/i);
});

test('confirmacion antigua con precio pendiente no modifica fichas ni agenda', async () => {
  services = [{ ...massage, priceUsd: 0 }];
  let creates = 0;
  prisma.client.upsert = async () => { creates++; return {}; };
  await scoped(async () => {
    state.setFlowState(conv.customerWaId, { booking: { step: 'confirm', serviceId: massage.id, timeSlot: '2099-01-01T15:00:00Z', clientName: 'Persona ficticia' } });
    await bot._internals.handleBookingConfirm({ tenant, connection, conv, waId: conv.customerWaId, tone: 'tu' });
  });
  assert.equal(creates, 0);
  assert.doesNotMatch(sent.join('\n'), /espacio está reservado/);
});

test('seleccion antigua de un servicio interno no revela su descripcion', async () => {
  services = [{ ...massage, name: 'Cumpleaños', category: 'recordatorio', description: 'PRIVATE-SYNTHETIC-MARKER' }];
  await scoped(() => bot._internals.handleServiceDetail({ tenant, connection, conv, waId: conv.customerWaId, tone: 'tu', serviceId: massage.id }));
  assert.ok(sent.every((body) => !body.includes('PRIVATE-SYNTHETIC-MARKER')));
});

test('descripcion y mensajes largos conservan advertencia final sin superar limite', () => {
  const description = `${'Descripcion larga. '.repeat(500)}ADVERTENCIA-FINAL`;
  assert.equal(bot._internals.serviceCatalogDescription({ description }), description);
  const chunks = bot._internals.splitMessage(description);
  assert.ok(chunks.every((chunk) => chunk.length <= 3500));
  assert.ok(chunks.at(-1).endsWith('ADVERTENCIA-FINAL'));
  assert.ok(bot._internals.splitMessage('x'.repeat(9500)).every((chunk) => chunk.length <= 3500));
});

test('cancelacion requiere confirmacion y resultado positivo del sistema', async () => {
  client = { id: 'synthetic-client' };
  upcoming = [{ id: 'appointment', startsAt: '2099-01-01T15:00:00Z', service: massage }];
  await inbound('cancelar mi cita');
  assert.equal(cancelCalls, 0);
  assert.match(sent[0], /confirmas/i);
  await inbound('si');
  assert.equal(cancelCalls, 1);
  assert.match(sent.at(-1), /ha sido cancelada/);
});

test('cancelacion fallida nunca anuncia exito', async () => {
  client = { id: 'synthetic-client' };
  upcoming = [{ id: 'appointment', startsAt: '2099-01-01T15:00:00Z', service: massage }];
  appointments.cancelWhatsAppAppointment = async () => { throw new Error('Synthetic failure'); };
  await inbound('cancelar mi cita'); await inbound('si');
  assert.match(sent.at(-1), /No pude confirmar/);
  assert.doesNotMatch(sent.at(-1), /ha sido cancelada/);
});

test('otra reserva abandona la cancelacion pendiente antes de aceptar un si', async () => {
  appointments.getAvailability = async () => ['2099-08-03T14:00:00.000Z'];
  let created = 0;
  appointments.resolveAndCreateAppointment = async () => { created++; return { id: 'new-booking' }; };
  await scoped(async () => {
    state.setFlowState(conv.customerWaId, { flow: 'cancel_appointment', cancellation: { step: 'confirm', appointmentId: 'old-appointment' } });
    await bot._internals.handleSmartBooking({ tenant, connection, conv, waId: conv.customerWaId, tone: 'tu', service: massage, date: '2099-08-03' });
    assert.equal(state.getFlowState(conv.customerWaId).cancellation, null);
    state.setFlowState(conv.customerWaId, { flow: 'booking', booking: { step: 'confirm', serviceId: massage.id, serviceName: massage.name, clientId: 'synthetic-client', clientName: 'Persona ficticia', timeSlot: '2099-08-03T14:00:00.000Z' } });
    await inbound('si');
  });
  assert.equal(cancelCalls, 0);
  assert.equal(created, 1);
  assert.match(sent.at(-1), /espacio está reservado/);
});

test('reprogramacion sin resultado del sistema no anuncia exito', async () => {
  appointments.updateAppointment = async () => null;
  await scoped(async () => {
    state.setFlowState(conv.customerWaId, { flow: 'reschedule', reschedule: { appointmentId: 'appointment', timeSlot: '2099-08-03T14:00:00.000Z', serviceName: massage.name } });
    await bot._internals.handleRescheduleConfirm({ tenant, connection, conv, waId: conv.customerWaId, tone: 'tu' });
  });
  assert.ok(sent.every((body) => !body.includes('actualicé tu espacio')));
  assert.match(sent.at(-1), /asesor/);
});

test('horario de asesores interpreta domingo igual que la configuracion operativa', () => {
  const config = { workDays: [0], businessHours: { start: '09:00', end: '12:00' } };
  assert.equal(bot._internals.isReceptionOpenNow(config, new Date('2026-10-11T15:00:00Z')), true);
  assert.equal(bot._internals.isReceptionOpenNow(config, new Date('2026-10-12T15:00:00Z')), false);
});
