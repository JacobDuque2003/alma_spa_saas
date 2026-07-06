const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const appointmentService = require('./appointmentService');

function mockPrisma({ service = {}, room = {}, user = {}, appointment = {}, client = {}, clientIntake = {} } = {}) {
  const tx = { service, room, user, appointment, client, clientIntake };
  prisma.service = service;
  prisma.room = room;
  prisma.user = user;
  prisma.appointment = appointment;
  prisma.client = client;
  prisma.clientIntake = clientIntake;
  prisma.$transaction = async (cb) => cb(tx);
}

const basePayload = (overrides = {}) => ({
  fullName: 'Cliente Nuevo',
  whatsapp: '+593999000001',
  selections: [{ serviceId: 'srv1', startsAt: '2026-08-01T14:00:00.000Z', modality: 'spa' }],
  ...overrides,
});

test('createPublicBooking rechaza con 400 si serviceId no pertenece al tenant', async () => {
  mockPrisma({
    client: { upsert: async () => ({ id: 'client1' }) },
    service: { findFirst: async () => null },
  });

  await assert.rejects(
    () => appointmentService.createPublicBooking('t1', basePayload()),
    (err) => err.status === 400
  );
});

test('createPublicBooking rechaza con 409 si no hay ningún room de la categoría del servicio', async () => {
  mockPrisma({
    client: { upsert: async () => ({ id: 'client1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 45, offersHomeService: false }) },
    room: { findMany: async () => [] },
    user: { findMany: async () => [{ id: 'staff1' }] },
    appointment: { findMany: async () => [] },
  });

  await assert.rejects(
    () => appointmentService.createPublicBooking('t1', basePayload()),
    (err) => err.status === 409
  );
});

test('createPublicBooking rechaza con 409 si no hay ningún staff habilitado', async () => {
  mockPrisma({
    client: { upsert: async () => ({ id: 'client1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 45, offersHomeService: false }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    user: { findMany: async () => [] },
    appointment: { findMany: async () => [] },
  });

  await assert.rejects(
    () => appointmentService.createPublicBooking('t1', basePayload()),
    (err) => err.status === 409
  );
});

test('createPublicBooking reintenta con el siguiente candidato ante P2002 y termina creando la cita', async () => {
  let createCalls = 0;
  mockPrisma({
    client: { upsert: async () => ({ id: 'client1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 45, offersHomeService: false }) },
    room: { findMany: async () => [{ id: 'room1' }, { id: 'room2' }] },
    user: { findMany: async () => [{ id: 'staff1' }] },
    appointment: {
      findMany: async () => [],
      create: async (args) => {
        createCalls += 1;
        if (createCalls === 1) {
          const err = new Error('unique constraint');
          err.code = 'P2002';
          throw err;
        }
        return { id: 'appt1', confirmationToken: 'token1', ...args.data };
      },
    },
  });

  const result = await appointmentService.createPublicBooking('t1', basePayload());
  assert.equal(createCalls, 2);
  assert.equal(result.appointments[0].roomId, 'room2');
});

test('createPublicBooking rechaza modality domicilio si el servicio no la ofrece', async () => {
  mockPrisma({
    client: { upsert: async () => ({ id: 'client1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 45, offersHomeService: false }) },
  });

  await assert.rejects(
    () =>
      appointmentService.createPublicBooking(
        't1',
        basePayload({ selections: [{ serviceId: 'srv1', startsAt: '2026-08-01T14:00:00.000Z', modality: 'domicilio', homeAddress: 'Av. X' }] })
      ),
    (err) => err.status === 400
  );
});

test('createPublicBooking crea con roomId=null cuando modality=domicilio y el servicio sí la ofrece', async () => {
  mockPrisma({
    client: { upsert: async () => ({ id: 'client1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 45, offersHomeService: true }) },
    room: {
      findMany: async () => {
        throw new Error('no debería consultarse Room en modalidad domicilio');
      },
    },
    user: { findMany: async () => [{ id: 'staff1' }] },
    appointment: { findMany: async () => [], create: async (args) => ({ id: 'appt1', confirmationToken: 'tok', ...args.data }) },
  });

  const result = await appointmentService.createPublicBooking(
    't1',
    basePayload({ selections: [{ serviceId: 'srv1', startsAt: '2026-08-01T14:00:00.000Z', modality: 'domicilio', homeAddress: 'Av. X 123' }] })
  );
  assert.equal(result.appointments[0].roomId, null);
  assert.equal(result.appointments[0].homeAddress, 'Av. X 123');
});

test('cancelBookingByToken rechaza cancelar una cita cuyo startsAt ya pasó', async () => {
  mockPrisma({
    appointment: { findUnique: async () => ({ id: 'a1', startsAt: new Date('2020-01-01T00:00:00Z') }) },
  });

  await assert.rejects(
    () => appointmentService.cancelBookingByToken('tok1'),
    (err) => err.status === 400
  );
});

test('cancelBookingByToken cancela una cita futura', async () => {
  const future = new Date(Date.now() + 86_400_000);
  mockPrisma({
    appointment: {
      findUnique: async () => ({ id: 'a1', startsAt: future }),
      update: async () => ({ status: 'cancelado' }),
    },
  });

  const result = await appointmentService.cancelBookingByToken('tok1');
  assert.equal(result.status, 'cancelado');
});

test('getAvailability rechaza con 400 si modality=domicilio y el servicio no la ofrece', async () => {
  mockPrisma({
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', offersHomeService: false }) },
  });

  await assert.rejects(
    () => appointmentService.getAvailability({ tenantId: 't1', tenantConfig: {}, serviceId: 'srv1', date: '2026-08-01', modality: 'domicilio' }),
    (err) => err.status === 400
  );
});

test('la query de candidatos de staff filtra explícitamente por canAttendAppointments=true', async () => {
  let capturedWhere = null;
  mockPrisma({
    client: { upsert: async () => ({ id: 'client1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 45, offersHomeService: false }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    user: {
      findMany: async (args) => {
        capturedWhere = args.where;
        return [{ id: 'staff1' }];
      },
    },
    appointment: { findMany: async () => [], create: async (args) => ({ id: 'appt1', confirmationToken: 'tok', ...args.data }) },
  });

  await appointmentService.createPublicBooking('t1', basePayload());
  assert.equal(capturedWhere.canAttendAppointments, true);
  assert.deepEqual(capturedWhere.role, { in: ['personal', 'dueno'] });
});

test('getAvailability devuelve lista vacía si no hay ningún staff habilitado', async () => {
  mockPrisma({
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', offersHomeService: false }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    user: { findMany: async () => [] },
  });

  const slots = await appointmentService.getAvailability({ tenantId: 't1', tenantConfig: {}, serviceId: 'srv1', date: '2026-08-01', modality: 'spa' });
  assert.deepEqual(slots, []);
});
