const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const appointmentService = require('./appointmentService');

function mockPrisma({ service = {}, room = {}, user = {}, appointment = {}, client = {}, clientIntake = {}, tenant = {} } = {}) {
  const tenantMock = {
    findUnique: async () => ({ config: { businessHours: { morning: { start: '09:00', end: '12:00' }, afternoon: { start: '15:00', end: '20:00' } } } }),
    ...tenant,
  };
  const tx = { service, room, user, appointment, client, clientIntake, tenant: tenantMock };
  prisma.service = service;
  prisma.room = room;
  prisma.user = user;
  prisma.appointment = appointment;
  prisma.client = client;
  prisma.clientIntake = clientIntake;
  prisma.tenant = tenantMock;
  prisma.$transaction = async (cb) => cb(tx);
}

const basePayload = (overrides = {}) => ({
  fullName: 'Cliente Nuevo',
  whatsapp: '+593999000001',
  selections: [{ serviceId: 'srv1', startsAt: '2099-08-01T14:00:00.000Z', modality: 'spa' }],
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

test('createPublicBooking rechaza modality domicilio aunque el servicio la tenga marcada', async () => {
  mockPrisma({
    client: { upsert: async () => ({ id: 'client1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 45, offersHomeService: true }) },
  });

  await assert.rejects(
    () =>
      appointmentService.createPublicBooking(
        't1',
        basePayload({ selections: [{ serviceId: 'srv1', startsAt: '2099-08-01T14:00:00.000Z', modality: 'domicilio', homeAddress: 'Av. X' }] })
      ),
    (err) => err.status === 400 && /domicilio/.test(err.message)
  );
});

test('createPublicBooking rechaza modality domicilio aunque el servicio sí la ofrece', async () => {
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

  await assert.rejects(
    () => appointmentService.createPublicBooking(
      't1',
      basePayload({ selections: [{ serviceId: 'srv1', startsAt: '2099-08-01T14:00:00.000Z', modality: 'domicilio', homeAddress: 'Av. X 123' }] })
    ),
    (err) => err.status === 400 && /domicilio/.test(err.message)
  );
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

test('createPublicBooking rechaza citas fuera del horario dividido', async () => {
  mockPrisma({
    client: { upsert: async () => ({ id: 'client1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 45, offersHomeService: false }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    user: { findMany: async () => [{ id: 'staff1' }] },
    appointment: { findMany: async () => [], create: async (args) => ({ id: 'appt1', confirmationToken: 'tok', ...args.data }) },
  });

  await assert.rejects(
    () => appointmentService.createPublicBooking(
      't1',
      basePayload({ selections: [{ serviceId: 'srv1', startsAt: '2099-08-01T17:00:00.000Z', modality: 'spa' }] })
    ),
    (err) => err.status === 400 && /fuera del horario/.test(err.message)
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

test('getAvailability rechaza con 400 si modality=domicilio', async () => {
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


test('createManualAppointment rechaza gabinete incompatible con la categoria del servicio', async () => {
  mockPrisma({
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 30, offersHomeService: false }) },
    user: { findFirst: async () => ({ id: 'staff1' }) },
    room: { findMany: async () => [{ id: 'room-masajes' }] },
    appointment: { findMany: async () => [] },
  });

  await assert.rejects(
    () => appointmentService.createManualAppointment(
      { role: 'dueno', tenantId: 't1' },
      { clientId: 'c1', serviceId: 'srv1', staffId: 'staff1', roomId: 'room-corporal', startsAt: '2099-08-01T14:00:00.000Z', modality: 'presencial' }
    ),
    (err) => err.status === 400 && /cabina seleccionada/.test(err.message)
  );
});

test('createManualAppointment autoasigna un gabinete compatible libre si no se envia roomId', async () => {
  mockPrisma({
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 30, offersHomeService: false }) },
    user: { findFirst: async () => ({ id: 'staff1' }) },
    room: { findMany: async () => [{ id: 'room1' }, { id: 'room2' }] },
    appointment: {
      findMany: async () => [{
        roomId: 'room1',
        staffId: 'staff2',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
        endsAt: new Date('2099-08-01T15:15:00.000Z'),
      }],
      create: async (args) => ({ id: 'appt1', ...args.data }),
    },
  });

  const result = await appointmentService.createManualAppointment(
    { role: 'dueno', tenantId: 't1' },
    { clientId: 'c1', serviceId: 'srv1', staffId: 'staff1', startsAt: '2099-08-01T14:00:00.000Z', modality: 'presencial' }
  );

  assert.equal(result.roomId, 'room2');
  assert.equal(result.status, 'confirmado');
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

test('getRescheduleAvailability conserva cabina y terapeuta, excluye la cita actual y respeta el bloque completo', async () => {
  mockPrisma({
    service: {
      findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15 }),
    },
    room: {
      findMany: async () => [{ id: 'room1', specialty: 'masajes' }],
    },
    user: {
      findFirst: async () => ({ id: 'staff1' }),
    },
    appointment: {
      findUnique: async () => ({ id: 'appt1', tenantId: 't1', serviceId: 'srv1', roomId: 'room1', staffId: 'staff1' }),
      findMany: async () => [{
        id: 'other', roomId: 'room1', staffId: 'staff1',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
        endsAt: new Date('2099-08-01T15:15:00.000Z'),
      }],
    },
  });

  const slots = await appointmentService.getRescheduleAvailability({
    tenantId: 't1',
    tenantConfig: { businessHours: { morning: { start: '09:00', end: '12:00' }, afternoon: null } },
    appointmentId: 'appt1',
    date: '2099-08-01',
  });

  assert.equal(slots.includes('2099-08-01T14:00:00.000Z'), false, 'no ofrece un bloque que cruza una cita existente');
  assert.equal(slots.includes('2099-08-01T15:15:00.000Z'), true, 'ofrece el siguiente bloque completo disponible');
});

test('listAppointments permite filtrar historial por clienta sin salir del tenant', async () => {
  let seenArgs;
  mockPrisma({
    appointment: {
      findMany: async (args) => {
        seenArgs = args;
        return [];
      },
    },
  });

  const result = await appointmentService.listAppointments(
    { role: 'dueno', tenantId: 't1' },
    { clientId: 'client-123' }
  );

  assert.deepEqual(result, []);
  assert.equal(seenArgs.where.tenantId, 't1');
  assert.equal(seenArgs.where.clientId, 'client-123');
});

test('updateAppointment rechaza reprogramar fuera del horario dividido', async () => {
  mockPrisma({
    service: { findUnique: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15 }) },
    room: { findMany: async () => [{ id: 'room1', specialty: 'masajes' }] },
    appointment: {
      findUnique: async () => ({
        id: 'appt1',
        tenantId: 't1',
        serviceId: 'srv1',
        roomId: 'room1',
        staffId: 'staff1',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
      }),
      findMany: async () => [],
      update: async () => {
        throw new Error('no debe actualizar si está fuera de horario');
      },
    },
  });

  await assert.rejects(
    () => appointmentService.updateAppointment(
      { role: 'dueno', tenantId: 't1' },
      'appt1',
      { startsAt: '2099-08-01T17:00:00.000Z' }
    ),
    (err) => err.status === 400 && /fuera del horario/.test(err.message)
  );
});
