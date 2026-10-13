const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const supertest = require('supertest');

process.env.INTAKE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
const prisma = require('../../utils/prisma');
const { customerServiceWhere } = require('../../utils/customerServicePolicy');
const appointmentService = require('../../services/appointmentService');
const notifier = require('../../services/bookingNotifier');
const router = require('./booking');
notifier.notifyBookingCreated = async () => {};

const service = { id: 'srv1', tenantId: 't1', active: true, name: 'Facial', category: 'Faciales', priceUsd: 40, durationMins: 60, bufferMins: 15 };
const config = { timezone: 'America/Guayaquil', businessHours: { morning: { start: '09:00', end: '12:00' }, afternoon: { start: '15:00', end: '20:00' } } };
const payload = () => ({ fullName: 'Cliente de prueba', whatsapp: '+593999000001', bookingConsent: true, selections: [{ serviceId: 'srv1', startsAt: '2099-08-03T14:00:00.000Z', modality: 'spa' }] });
let sequence = 0;

function setup({ services = [service], tenantConfig = config, clientRecord = null } = {}) {
  const seen = { serviceQueries: [], clientReads: 0, clientWrites: 0, intakeWrites: [], appointments: [] };
  prisma.tenant = { findUnique: async () => ({ id: 't1', slug: 'alma-spa', active: true, config: tenantConfig }) };
  prisma.service = {
    findMany: async ({ where }) => { seen.serviceQueries.push(where); return services; },
    findFirst: async ({ where }) => {
      seen.serviceQueries.push(where);
      return services.find((item) => item.id === where.id && item.tenantId === where.tenantId) || null;
    },
  };
  prisma.client = {
    findUnique: async ({ select }) => {
      seen.clientReads += 1;
      return clientRecord ? Object.fromEntries(Object.keys(select).map((key) => [key, clientRecord[key]])) : null;
    },
    createMany: async ({ data }) => {
      seen.clientWrites += 1;
      clientRecord = { id: 'c1', ...data };
      return { count: 1 };
    },
  };
  prisma.clientIntake = { upsert: async (args) => { seen.intakeWrites.push(args); return {}; } };
  prisma.room = { findMany: async () => [{ id: 'r1', capacity: 1 }] };
  prisma.user = { findMany: async () => [{ id: 'u1' }] };
  prisma.appointment = {
    findMany: async () => [],
    create: async ({ data }) => { seen.appointments.push(data); return { id: 'a1', confirmationToken: 'test-token', ...data }; },
  };
  prisma.$transaction = async (fn) => fn(prisma);
  const app = express();
  app.set('trust proxy', true);
  const ip = `192.0.2.${++sequence}`;
  app.use((req, res, next) => { req.headers['x-forwarded-for'] = ip; next(); });
  app.use(express.json());
  app.use('/public/:tenantSlug', router);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  return { api: supertest(app), seen };
}

test('catalogo publico filtra internos y presenta precio pendiente para asesor', async () => {
  const { api, seen } = setup({ services: [service, { ...service, id: 'pending', priceUsd: 0 },
    { ...service, id: 'birthday', name: 'Cumpleaños' }, { ...service, id: 'shop', category: 'tienda' },
    { ...service, id: 'reminder', category: 'recordatorio' }, { ...service, id: 'inactive', active: false }] });
  const response = await api.get('/public/alma-spa/services');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.map((item) => item.id), ['srv1', 'pending']);
  assert.equal(response.body[1].priceLabel, 'Valor a confirmar');
  assert.equal(response.body[1].requiresAdvisor, true);
  assert.deepEqual(seen.serviceQueries[0], customerServiceWhere('t1'));
});

test('lookup publico uniforme para numero ausente, registrado y con consentimiento', async () => {
  for (const clientRecord of [null, { id: 'secret', intake: null }, { id: 'secret', intake: { consentSigned: false } }, { id: 'secret', intake: { consentSigned: true } }]) {
    const { api, seen } = setup({ clientRecord });
    const response = await api.post('/public/alma-spa/clients/lookup').send({ whatsapp: '+593999000001' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { requiresIntake: true });
    assert.equal(seen.clientReads, 0);
  }
});

test('IDs internos, inactivos, ajenos y desconocidos se rechazan en disponibilidad y creacion', async () => {
  for (const selected of [{ ...service, name: 'Cumpleaños' }, { ...service, category: 'tienda' },
    { ...service, category: 'recordatorio' }, { ...service, active: false }, { ...service, tenantId: 'other' }, null]) {
    const { api, seen } = setup({ services: selected ? [selected] : [] });
    const availability = await api.get('/public/alma-spa/availability').query({ serviceId: 'srv1', date: '2099-08-03', modality: 'spa', tenantId: 'other' });
    assert.equal(availability.status, 400);
    const booking = await api.post('/public/alma-spa/bookings').send({ ...payload(), tenantId: 'other' });
    assert.equal(booking.status, 400);
    assert.equal(seen.clientWrites, 0);
    assert.equal(seen.appointments.length, 0);
    assert.deepEqual(seen.serviceQueries[0], { id: 'srv1', ...customerServiceWhere('t1') });
  }
});

test('precio cero nunca permite disponibilidad ni reserva automatica', async () => {
  const { api, seen } = setup({ services: [{ ...service, priceUsd: 0 }] });
  const availability = await api.get('/public/alma-spa/availability').query({ serviceId: 'srv1', date: '2099-08-03' });
  const booking = await api.post('/public/alma-spa/bookings').send(payload());
  for (const response of [availability, booking]) {
    assert.equal(response.status, 400);
    assert.match(response.body.error, /Valor a confirmar.*asesor/);
  }
  assert.equal(seen.clientWrites, 0);
  assert.equal(seen.appointments.length, 0);
});

test('selecciones malformadas y consentimiento falso u omitido fallan antes de consultar clientes', async () => {
  const { api, seen } = setup();
  for (const selections of [[null], [{}], [{ serviceId: ['srv1'], startsAt: '2099-08-03T14:00:00Z' }], []]) {
    assert.equal((await api.post('/public/alma-spa/bookings').send({ ...payload(), selections })).status, 400);
  }
  for (const bookingConsent of [undefined, {}, false, 'true']) {
    assert.equal((await api.post('/public/alma-spa/bookings').send({ ...payload(), bookingConsent })).status, 400);
  }
  assert.equal(seen.clientReads, 0);
  assert.equal(seen.clientWrites, 0);
});

test('disponibilidad publica exige ID y fecha validos, sin aceptar flags internos', async () => {
  const { api } = setup();
  for (const query of [{ date: '2099-08-03' }, { serviceId: 'srv1' }, { serviceId: 'srv1', date: '2099-02-30' }]) {
    assert.equal((await api.get('/public/alma-spa/availability').query(query)).status, 400);
  }
  const response = await api.get('/public/alma-spa/availability').query({ serviceId: 'srv1', date: '2099-08-03', includeInternalHours: true, withoutStaff: true });
  assert.equal(response.status, 200);
  assert.ok(response.body.slots.length > 0);
  assert.ok(response.body.slots.every((slot) => new Date(slot).getUTCHours() >= 14));
});

test('reserva con consentimiento usa tenant del slug y no borra ficha medica', async () => {
  const { api, seen } = setup();
  const response = await api.post('/public/alma-spa/bookings').send({ ...payload(), tenantId: 'forged' });
  assert.equal(response.status, 201);
  assert.equal(seen.appointments[0].tenantId, 't1');
  assert.equal(Number(response.body.appointments[0].priceUsd), 40);
  assert.equal(seen.intakeWrites.length, 0);
  assert.equal('clientId' in response.body, false);
});

test('publico respeta workDays configurados sin extender atencion al sabado', async () => {
  const { api, seen } = setup({ tenantConfig: { ...config, workDays: [1, 2, 3, 4, 5] } });
  const response = await api.get('/public/alma-spa/availability').query({ serviceId: 'srv1', date: '2099-08-01' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.slots, []);
  const body = payload();
  body.selections[0].startsAt = '2099-08-01T14:00:00Z';
  assert.equal((await api.post('/public/alma-spa/bookings').send(body)).status, 400);
  assert.equal(seen.clientWrites, 0);
});

test('agenda interna conserva disponibilidad de recordatorio con precio cero', async () => {
  setup({ services: [{ ...service, name: 'Cumpleaños', category: 'recordatorio', priceUsd: 0 }] });
  const slots = await appointmentService.getAvailability({ tenantId: 't1', tenantConfig: config, serviceId: 'srv1', date: '2099-08-03', includeInternalHours: true });
  assert.ok(slots.length > 0);
  assert.equal(new Date(slots[0]).getUTCHours(), 13);
});

test('reserva de numero existente no modifica perfil ni consentimiento medico y no divulga identidad', async () => {
  const record = { id: 'secret-client-id', tenantId: 't1', whatsapp: '+593999000001', fullName: 'Nombre privado', address: 'Direccion privada', intake: { consentSigned: false } };
  const { api, seen } = setup({ clientRecord: record });
  const response = await api.post('/public/alma-spa/bookings').send({ ...payload(), fullName: 'Nombre forjado', address: 'Direccion forjada', intake: { consentSigned: true, allergies: 'forged', conditions: 'forged' } });
  assert.equal(response.status, 201);
  assert.equal(seen.clientWrites, 0);
  assert.equal(seen.intakeWrites.length, 0);
  assert.equal(record.fullName, 'Nombre privado');
  assert.equal(record.intake.consentSigned, false);
  assert.equal(JSON.stringify(response.body).includes('secret-client-id'), false);
  assert.equal(JSON.stringify(response.body).includes('Nombre privado'), false);
});

test('domingo ISO 7 y domingo legacy 0 producen la misma disponibilidad publica', async () => {
  const results = [];
  for (const workDays of [[7], [0]]) {
    const { api } = setup({ tenantConfig: { ...config, workDays } });
    const response = await api.get('/public/alma-spa/availability').query({ serviceId: 'srv1', date: '2099-08-02' });
    assert.equal(response.status, 200);
    assert.ok(response.body.slots.length > 0);
    results.push(response.body.slots);
  }
  assert.deepEqual(results[0], results[1]);
});

test('formulario publico no firma consentimiento clinico ni guarda anamnesis de una alta nueva', async () => {
  const { api, seen } = setup();
  const response = await api.post('/public/alma-spa/bookings').send({ ...payload(), intake: {
    consentSigned: true, consentSignedAt: '2000-01-01', allergies: 'injected', conditions: 'injected',
  } });
  assert.equal(response.status, 201);
  assert.equal(seen.clientWrites, 1);
  assert.equal(seen.intakeWrites.length, 0);
});

test('firma clinica en el body no sustituye consentimiento para gestionar la reserva', async () => {
  const { api, seen } = setup();
  const response = await api.post('/public/alma-spa/bookings').send({ ...payload(), bookingConsent: undefined, intake: { consentSigned: true } });
  assert.equal(response.status, 400);
  assert.equal(seen.clientWrites, 0);
  assert.equal(seen.intakeWrites.length, 0);
});
