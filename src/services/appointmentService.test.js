const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const appointmentService = require('./appointmentService');

function mockPrisma({ service = {}, room = {}, user = {}, appointment = {}, client = {}, clientIntake = {}, tenant = {}, adminAuditLog = {} } = {}) {
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
  prisma.adminAuditLog = adminAuditLog;
  prisma.$transaction = async (cb) => cb(tx);
}

const basePayload = (overrides = {}) => ({
  fullName: 'Cliente Nuevo',
  whatsapp: '+593999000001',
  selections: [{ serviceId: 'srv1', startsAt: '2099-08-01T14:00:00.000Z', modality: 'spa' }],
  ...overrides,
});

async function withMockedNow(iso, fn) {
  const originalNow = Date.now;
  Date.now = () => new Date(iso).getTime();
  try {
    return await fn();
  } finally {
    Date.now = originalNow;
  }
}

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

test('getAvailability interno ofrece horas extendidas sin cambiar la disponibilidad pública', async () => {
  mockPrisma({
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15, offersHomeService: false }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    user: { findMany: async () => [{ id: 'staff1' }] },
    appointment: { findMany: async () => [] },
  });

  const publicSlots = await appointmentService.getAvailability({
    tenantId: 't1',
    tenantConfig: { businessHours: { morning: { start: '09:00', end: '12:00' }, afternoon: { start: '15:00', end: '20:00' } } },
    serviceId: 'srv1',
    date: '2099-08-01',
    modality: 'spa',
  });
  const internalSlots = await appointmentService.getAvailability({
    tenantId: 't1',
    tenantConfig: { businessHours: { morning: { start: '09:00', end: '12:00' }, afternoon: { start: '15:00', end: '20:00' } } },
    serviceId: 'srv1',
    date: '2099-08-01',
    modality: 'spa',
    includeInternalHours: true,
  });

  assert.equal(publicSlots.includes('2099-08-02T01:30:00.000Z'), false);
  assert.equal(internalSlots.includes('2099-08-02T01:30:00.000Z'), true);
});

test('getAvailability interno puede incluir horas pasadas del mismo día sin afectar público', async () => {
  mockPrisma({
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15, offersHomeService: false }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    user: { findMany: async () => [{ id: 'staff1' }] },
    appointment: { findMany: async () => [] },
  });

  await withMockedNow('2099-08-01T16:00:00.000Z', async () => {
    const publicSlots = await appointmentService.getAvailability({
      tenantId: 't1',
      tenantConfig: { businessHours: { morning: { start: '09:00', end: '12:00' }, afternoon: null } },
      serviceId: 'srv1',
      date: '2099-08-01',
      modality: 'spa',
    });
    const internalSlots = await appointmentService.getAvailability({
      tenantId: 't1',
      tenantConfig: { businessHours: { morning: { start: '09:00', end: '12:00' }, afternoon: null } },
      serviceId: 'srv1',
      date: '2099-08-01',
      modality: 'spa',
      includePastSlots: true,
    });
    const previousDaySlots = await appointmentService.getAvailability({
      tenantId: 't1',
      tenantConfig: { businessHours: { morning: { start: '09:00', end: '12:00' }, afternoon: null } },
      serviceId: 'srv1',
      date: '2099-07-31',
      modality: 'spa',
      includePastSlots: true,
    });

    assert.equal(publicSlots.includes('2099-08-01T14:00:00.000Z'), false);
    assert.equal(internalSlots.includes('2099-08-01T14:00:00.000Z'), true);
    assert.deepEqual(previousDaySlots, []);
  });
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
    client: { findFirst: async () => ({ id: 'c1', tenantId: 't1' }) },
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
    client: { findFirst: async () => ({ id: 'c1', tenantId: 't1' }) },
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

test('createManualAppointment permite marcar una reserva sin terapeuta y no bloquea personal', async () => {
  let staffLookupCalled = false;
  mockPrisma({
    client: { findFirst: async () => ({ id: 'c1', tenantId: 't1' }) },
    service: { findFirst: async () => ({ id: 'srv-pies', category: 'pies', durationMins: 30, priceUsd: 20 }) },
    user: { findFirst: async () => { staffLookupCalled = true; return null; } },
    room: { findMany: async () => [{ id: 'room-pies', capacity: 1, requiresStaff: true }] },
    appointment: {
      findMany: async ({ where }) => {
        assert.equal(where.OR.some((condition) => condition.staffId), false);
        return [];
      },
      create: async (args) => ({ id: 'appt-pies', ...args.data }),
    },
  });

  const result = await appointmentService.createManualAppointment(
    { role: 'dueno', tenantId: 't1' },
    { clientId: 'c1', serviceId: 'srv-pies', roomId: 'room-pies', startsAt: '2099-08-01T14:00:00.000Z', withoutStaff: true }
  );

  assert.equal(staffLookupCalled, false);
  assert.equal(result.staffId, null);
  assert.equal(result.roomId, 'room-pies');
});

test('createManualAppointment autoasigna cabina cuando la reserva se marca sin terapeuta', async () => {
  mockPrisma({
    client: { findFirst: async () => ({ id: 'c1', tenantId: 't1' }) },
    service: { findFirst: async () => ({ id: 'srv-pies', category: 'pies', durationMins: 30, priceUsd: 20 }) },
    user: { findFirst: async () => { throw new Error('no debe buscar terapeuta'); } },
    room: { findMany: async () => [{ id: 'room-pies', capacity: 1, requiresStaff: true }] },
    appointment: {
      findMany: async () => [],
      create: async (args) => ({ id: 'appt-pies-auto', ...args.data }),
    },
  });

  const result = await appointmentService.createManualAppointment(
    { role: 'dueno', tenantId: 't1' },
    { clientId: 'c1', serviceId: 'srv-pies', startsAt: '2099-08-01T14:00:00.000Z', withoutStaff: true }
  );

  assert.equal(result.staffId, null);
  assert.equal(result.roomId, 'room-pies');
});

test('createManualAppointment permite compartir cabina con cupo si es el mismo servicio y hora', async () => {
  mockPrisma({
    client: { findFirst: async () => ({ id: 'c2', tenantId: 't1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 30, offersHomeService: false }) },
    user: { findFirst: async () => ({ id: 'staff1' }) },
    room: { findMany: async () => [{ id: 'room1', capacity: 2 }] },
    appointment: {
      findMany: async () => [{
        clientId: 'c1',
        serviceId: 'srv1',
        roomId: 'room1',
        staffId: 'staff2',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
        endsAt: new Date('2099-08-01T15:15:00.000Z'),
      }],
      create: async (args) => ({ id: 'appt2', ...args.data }),
    },
  });

  const result = await appointmentService.createManualAppointment(
    { role: 'dueno', tenantId: 't1' },
    { clientId: 'c2', serviceId: 'srv1', staffId: 'staff1', roomId: 'room1', startsAt: '2099-08-01T14:00:00.000Z', modality: 'presencial' }
  );

  assert.equal(result.roomId, 'room1');
});

test('createManualAppointment permite compartir terapeuta en el mismo grupo de cabina', async () => {
  mockPrisma({
    client: { findFirst: async () => ({ id: 'c2', tenantId: 't1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 30, offersHomeService: false }) },
    user: { findFirst: async () => ({ id: 'staff1' }) },
    room: { findMany: async () => [{ id: 'room1', capacity: 2 }] },
    appointment: {
      findMany: async () => [{
        clientId: 'c1',
        serviceId: 'srv1',
        roomId: 'room1',
        staffId: 'staff1',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
        endsAt: new Date('2099-08-01T15:15:00.000Z'),
      }],
      create: async (args) => ({ id: 'appt2', ...args.data }),
    },
  });

  const result = await appointmentService.createManualAppointment(
    { role: 'dueno', tenantId: 't1' },
    { clientId: 'c2', serviceId: 'srv1', staffId: 'staff1', roomId: 'room1', startsAt: '2099-08-01T14:00:00.000Z', modality: 'presencial' }
  );

  assert.equal(result.staffId, 'staff1');
  assert.equal(result.roomId, 'room1');
});

test('createManualAppointment no comparte terapeuta si no es el mismo grupo de cabina', async () => {
  mockPrisma({
    client: { findFirst: async () => ({ id: 'c2', tenantId: 't1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 30, offersHomeService: false }) },
    user: { findFirst: async () => ({ id: 'staff1' }) },
    room: { findMany: async () => [{ id: 'room1', capacity: 2 }, { id: 'room2', capacity: 2 }] },
    appointment: {
      findMany: async () => [{
        clientId: 'c1',
        serviceId: 'srv1',
        roomId: 'room2',
        staffId: 'staff1',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
        endsAt: new Date('2099-08-01T15:15:00.000Z'),
      }],
      create: async () => {
        throw new Error('no debe crear si la terapeuta está cruzada en otra cabina');
      },
    },
  });

  await assert.rejects(
    () => appointmentService.createManualAppointment(
      { role: 'dueno', tenantId: 't1' },
      { clientId: 'c2', serviceId: 'srv1', staffId: 'staff1', roomId: 'room1', startsAt: '2099-08-01T14:00:00.000Z', modality: 'presencial' }
    ),
    (err) => err.status === 409 && /terapeuta/.test(err.message)
  );
});

test('createManualAppointment no comparte cabina si el servicio o la hora no coinciden', async () => {
  mockPrisma({
    client: { findFirst: async () => ({ id: 'c2', tenantId: 't1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 30, offersHomeService: false }) },
    user: { findFirst: async () => ({ id: 'staff1' }) },
    room: { findMany: async () => [{ id: 'room1', capacity: 2 }] },
    appointment: {
      findMany: async () => [{
        clientId: 'c1',
        serviceId: 'srv-distinto',
        roomId: 'room1',
        staffId: 'staff2',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
        endsAt: new Date('2099-08-01T15:15:00.000Z'),
      }],
      create: async () => {
        throw new Error('no debe crear con servicio distinto en la misma cabina');
      },
    },
  });

  await assert.rejects(
    () => appointmentService.createManualAppointment(
      { role: 'dueno', tenantId: 't1' },
      { clientId: 'c2', serviceId: 'srv1', staffId: 'staff1', roomId: 'room1', startsAt: '2099-08-01T14:00:00.000Z', modality: 'presencial' }
    ),
    (err) => err.status === 409 && /puestos disponibles/.test(err.message)
  );
});

test('createManualAppointment permite a dueña crear reserva interna fuera del horario público', async () => {
  let createArgs = null;
  mockPrisma({
    client: { findFirst: async () => ({ id: 'c1', tenantId: 't1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15, priceUsd: 30, offersHomeService: false }) },
    user: { findFirst: async () => ({ id: 'staff1' }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    appointment: {
      findMany: async () => [],
      create: async (args) => {
        createArgs = args;
        return { id: 'appt1', ...args.data };
      },
    },
  });

  const result = await appointmentService.createManualAppointment(
    { id: 'owner1', role: 'dueno', tenantId: 't1' },
    {
      clientId: 'c1',
      serviceId: 'srv1',
      staffId: 'staff1',
      startsAt: '2099-08-02T02:00:00.000Z',
      modality: 'presencial',
      allowOutsideBusinessHours: true,
      outsideBusinessHoursReason: 'Gianella atiende personalmente despues del cierre',
    }
  );

  assert.equal(result.outsideBusinessHours, true);
  assert.equal(createArgs.data.outsideBusinessHoursById, 'owner1');
  assert.match(createArgs.data.outsideBusinessHoursReason, /Gianella atiende/);
});

test('createManualAppointment permite registrar una cita pasada del mismo día en agenda interna', async () => {
  mockPrisma({
    client: { findFirst: async () => ({ id: 'c1', tenantId: 't1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15, priceUsd: 30, offersHomeService: false }) },
    user: { findFirst: async () => ({ id: 'staff1' }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    appointment: {
      findMany: async () => [],
      create: async (args) => ({ id: 'appt1', ...args.data }),
    },
  });

  await withMockedNow('2099-08-01T16:00:00.000Z', async () => {
    const result = await appointmentService.createManualAppointment(
      { id: 'staff2', role: 'personal', tenantId: 't1' },
      {
        clientId: 'c1',
        serviceId: 'srv1',
        staffId: 'staff1',
        roomId: 'room1',
        startsAt: '2099-08-01T14:00:00.000Z',
        modality: 'presencial',
      }
    );

    assert.equal(result.status, 'confirmado');
    assert.equal(result.startsAt.toISOString(), '2099-08-01T14:00:00.000Z');
    assert.equal(result.outsideBusinessHours, false);
  });
});

test('createManualAppointment sigue rechazando citas pasadas de días anteriores', async () => {
  mockPrisma({
    client: { findFirst: async () => ({ id: 'c1', tenantId: 't1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15, priceUsd: 30, offersHomeService: false }) },
    user: { findFirst: async () => ({ id: 'staff1' }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    appointment: {
      findMany: async () => [],
      create: async () => {
        throw new Error('no debe crear una cita pasada de otro día');
      },
    },
  });

  await withMockedNow('2099-08-02T16:00:00.000Z', async () => {
    await assert.rejects(
      () => appointmentService.createManualAppointment(
        { id: 'staff2', role: 'personal', tenantId: 't1' },
        {
          clientId: 'c1',
          serviceId: 'srv1',
          staffId: 'staff1',
          roomId: 'room1',
          startsAt: '2099-08-01T14:00:00.000Z',
          modality: 'presencial',
        }
      ),
      (err) => err.status === 400 && /mismo día/.test(err.message)
    );
  });
});

test('createManualAppointment rechaza excepción fuera de horario para personal no dueño', async () => {
  mockPrisma({
    client: { findFirst: async () => ({ id: 'c1', tenantId: 't1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15, priceUsd: 30, offersHomeService: false }) },
    user: { findFirst: async () => ({ id: 'staff1' }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    appointment: {
      findMany: async () => [],
      create: async () => {
        throw new Error('no debe crear una excepción para personal');
      },
    },
  });

  await assert.rejects(
    () => appointmentService.createManualAppointment(
      { id: 'staff2', role: 'personal', tenantId: 't1' },
      {
        clientId: 'c1',
        serviceId: 'srv1',
        staffId: 'staff1',
        startsAt: '2099-08-02T02:00:00.000Z',
        modality: 'presencial',
        allowOutsideBusinessHours: true,
        outsideBusinessHoursReason: 'Atención autorizada fuera de horario',
      }
    ),
    (err) => err.status === 403 && /Solo una dueña/.test(err.message)
  );
});

test('createPublicBooking sigue rechazando horarios fuera del horario público', async () => {
  mockPrisma({
    client: { upsert: async () => ({ id: 'client1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15, priceUsd: 45, offersHomeService: false }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    user: { findMany: async () => [{ id: 'staff1' }] },
    appointment: { findMany: async () => [] },
  });

  await assert.rejects(
    () => appointmentService.createPublicBooking(
      't1',
      basePayload({ selections: [{ serviceId: 'srv1', startsAt: '2099-08-02T02:00:00.000Z', modality: 'spa' }] })
    ),
    (err) => err.status === 400 && /fuera del horario/.test(err.message)
  );
});

test('createManualAppointment distingue fichas diferentes aunque los clientes tengan el mismo nombre', async () => {
  mockPrisma({
    client: { findFirst: async () => ({ id: 'ficha-seleccionada', tenantId: 't1' }) },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 30, offersHomeService: false }) },
    user: { findFirst: async () => ({ id: 'staff1' }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    appointment: {
      findMany: async () => [{
        clientId: 'ficha-distinta',
        staffId: 'staff2',
        roomId: 'room2',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
        endsAt: new Date('2099-08-01T15:15:00.000Z'),
      }],
      create: async (args) => ({ id: 'appt1', ...args.data }),
    },
  });

  const result = await appointmentService.createManualAppointment(
    { role: 'dueno', tenantId: 't1' },
    { clientId: 'ficha-seleccionada', serviceId: 'srv1', staffId: 'staff1', startsAt: '2099-08-01T14:00:00.000Z', modality: 'presencial' }
  );

  assert.equal(result.clientId, 'ficha-seleccionada');
});

test('C-1: createManualAppointment RECHAZA clientId de otro tenant (cross-tenant PII leak guard)', async () => {
  // Simula el ataque: dueño autenticado en tenant 't1' intenta crear una cita
  // con un clientId que pertenece al tenant 't2'. findFirst({id, tenantId:'t1'})
  // devuelve null porque el cliente pertenece a otro tenant.
  let createCalled = false;
  let clientLookupArgs = null;
  mockPrisma({
    client: {
      findFirst: async (args) => {
        clientLookupArgs = args;
        // No existe cliente con id='cross-tenant-client' en tenant 't1'
        return null;
      },
    },
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, priceUsd: 30, offersHomeService: false }) },
    user: { findFirst: async () => ({ id: 'staff1' }) },
    room: { findMany: async () => [{ id: 'room1' }] },
    appointment: {
      findMany: async () => [],
      create: async () => { createCalled = true; return {}; },
    },
  });

  await assert.rejects(
    () => appointmentService.createManualAppointment(
      { role: 'dueno', tenantId: 't1' },
      { clientId: 'cross-tenant-client', serviceId: 'srv1', staffId: 'staff1', startsAt: '2099-08-01T14:00:00.000Z', modality: 'presencial' }
    ),
    (err) => err.status === 400 && /clientId invalido/i.test(err.message)
  );

  assert.equal(createCalled, false, 'MUST NOT create the appointment when clientId is cross-tenant');
  assert.equal(clientLookupArgs?.where?.id, 'cross-tenant-client');
  assert.equal(clientLookupArgs?.where?.tenantId, 't1', 'lookup must be scoped to actor tenant');
});

test('M-3: updateAppointment RECHAZA staffId de otro tenant', async () => {
  // Dueño de t1 patchea su propia cita con staffId de t2. El findFirst scopeado
  // a target.tenantId devuelve null → rechazo 400.
  let updateCalled = false;
  mockPrisma({
    service: { findUnique: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15 }) },
    user: {
      findFirst: async (args) => {
        // Simula que el staffId 'staff-cross-tenant' no existe en target.tenantId='t1'
        return null;
      },
    },
    room: { findMany: async () => [{ id: 'room1' }] },
    appointment: {
      findUnique: async () => ({
        id: 'appt1', tenantId: 't1', serviceId: 'srv1',
        roomId: 'room1', staffId: 'staff1', clientId: 'c1',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
      }),
      findMany: async () => [],
      update: async () => { updateCalled = true; return {}; },
    },
  });

  await assert.rejects(
    () => appointmentService.updateAppointment(
      { role: 'dueno', tenantId: 't1' },
      'appt1',
      { staffId: 'staff-cross-tenant' }
    ),
    (err) => err.status === 400 && /staffId invalido/i.test(err.message)
  );

  assert.equal(updateCalled, false, 'MUST NOT update when staffId is cross-tenant');
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

test('getAvailability ofrece horarios sin personal cuando la reserva se marca sin terapeuta', async () => {
  mockPrisma({
    service: { findFirst: async () => ({ id: 'srv1', category: 'pies', durationMins: 30, bufferMins: 15 }) },
    room: { findMany: async () => [{ id: 'room1', specialty: 'pies', capacity: 1, requiresStaff: true }] },
    user: { findMany: async () => [] },
    appointment: { findMany: async () => [] },
  });

  const slots = await appointmentService.getAvailability({
    tenantId: 't1',
    tenantConfig: { businessHours: { morning: { start: '09:00', end: '12:00' }, afternoon: null } },
    serviceId: 'srv1',
    date: '2099-08-01',
    modality: 'spa',
    withoutStaff: true,
  });

  assert.ok(slots.length > 0);
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

test('getRescheduleAvailability usa la duración real personalizada de la cita', async () => {
  mockPrisma({
    adminAuditLog: { create: async () => ({}) },
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
      findUnique: async () => ({
        id: 'appt1',
        tenantId: 't1',
        serviceId: 'srv1',
        roomId: 'room1',
        staffId: 'staff1',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
        endsAt: new Date('2099-08-01T14:45:00.000Z'),
      }),
      findMany: async () => [],
    },
  });

  const slots = await appointmentService.getRescheduleAvailability({
    tenantId: 't1',
    tenantConfig: { businessHours: { morning: { start: '09:00', end: '10:00' }, afternoon: null } },
    appointmentId: 'appt1',
    date: '2099-08-01',
  });

  assert.equal(slots.includes('2099-08-01T14:00:00.000Z'), true, '45 minutos sí caben en una ventana de 1 hora');
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

test('listAppointments usa fin de rango exclusivo para días locales de agenda', async () => {
  let seenArgs;
  mockPrisma({
    appointment: {
      findMany: async (args) => {
        seenArgs = args;
        return [];
      },
    },
  });

  await appointmentService.listAppointments(
    { role: 'dueno', tenantId: 't1' },
    {
      from: '2026-09-11T05:00:00.000Z',
      to: '2026-09-12T05:00:00.000Z',
    }
  );

  assert.equal(seenArgs.where.startsAt.gte.toISOString(), '2026-09-11T05:00:00.000Z');
  assert.equal(seenArgs.where.startsAt.lt.toISOString(), '2026-09-12T05:00:00.000Z');
  assert.equal('lte' in seenArgs.where.startsAt, false);
});

test('listServiceLegend devuelve solo servicios activos del tenant con nombre y color', async () => {
  let seenArgs;
  mockPrisma({
    service: {
      findMany: async (args) => {
        seenArgs = args;
        return [{ id: 'srv1', name: 'Masaje', colorHex: '#8C6E50' }];
      },
    },
  });

  const result = await appointmentService.listServiceLegend({ role: 'personal', tenantId: 't1' });

  assert.deepEqual(result, [{ id: 'srv1', name: 'Masaje', colorHex: '#8C6E50' }]);
  assert.deepEqual(seenArgs.where, { active: true, tenantId: 't1' });
  assert.deepEqual(seenArgs.select, { id: true, name: true, colorHex: true });
});

test('updateAppointment rechaza reprogramar fuera del horario dividido', async () => {
  mockPrisma({
    adminAuditLog: { create: async () => ({}) },
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

test('updateAppointment permite mover a un grupo con la misma terapeuta si hay puesto disponible', async () => {
  let updateData = null;
  mockPrisma({
    service: { findUnique: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15 }) },
    room: { findMany: async () => [{ id: 'room1', specialty: 'masajes', capacity: 2 }] },
    appointment: {
      findUnique: async () => ({
        id: 'appt1',
        tenantId: 't1',
        serviceId: 'srv1',
        roomId: 'room1',
        staffId: 'staff1',
        clientId: 'c2',
        startsAt: new Date('2099-08-01T16:00:00.000Z'),
      }),
      findMany: async () => [{
        id: 'other',
        clientId: 'c1',
        serviceId: 'srv1',
        roomId: 'room1',
        staffId: 'staff1',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
        endsAt: new Date('2099-08-01T15:15:00.000Z'),
      }],
      update: async ({ data }) => {
        updateData = data;
        return { id: 'appt1', ...data };
      },
    },
  });

  const result = await appointmentService.updateAppointment(
    { role: 'dueno', tenantId: 't1' },
    'appt1',
    { startsAt: '2099-08-01T14:00:00.000Z' }
  );

  assert.equal(result.endsAt.toISOString(), '2099-08-01T15:15:00.000Z');
  assert.equal(updateData.startsAt.toISOString(), '2099-08-01T14:00:00.000Z');
});

test('updateAppointment permite ajustar la hora fin de una cita puntual', async () => {
  let updateData = null;
  mockPrisma({
    service: { findUnique: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15 }) },
    room: { findMany: async () => [{ id: 'room1', specialty: 'masajes', capacity: 1 }] },
    appointment: {
      findUnique: async () => ({
        id: 'appt1',
        tenantId: 't1',
        serviceId: 'srv1',
        roomId: 'room1',
        staffId: 'staff1',
        clientId: 'c1',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
        endsAt: new Date('2099-08-01T15:15:00.000Z'),
      }),
      findMany: async () => [],
      update: async ({ data }) => {
        updateData = data;
        return { id: 'appt1', ...data };
      },
    },
  });

  const result = await appointmentService.updateAppointment(
    { role: 'dueno', tenantId: 't1' },
    'appt1',
    { endsAt: '2099-08-01T14:45:00.000Z' }
  );

  assert.equal(result.endsAt.toISOString(), '2099-08-01T14:45:00.000Z');
  assert.equal(updateData.startsAt, undefined);
});

test('updateAppointment rechaza alargar una cita si cruza otra reserva', async () => {
  mockPrisma({
    service: { findUnique: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15 }) },
    room: { findMany: async () => [{ id: 'room1', specialty: 'masajes', capacity: 1 }] },
    appointment: {
      findUnique: async () => ({
        id: 'appt1',
        tenantId: 't1',
        serviceId: 'srv1',
        roomId: 'room1',
        staffId: 'staff1',
        clientId: 'c1',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
        endsAt: new Date('2099-08-01T15:15:00.000Z'),
      }),
      findMany: async () => [{
        id: 'other',
        clientId: 'c2',
        serviceId: 'srv1',
        roomId: 'room1',
        staffId: 'staff1',
        startsAt: new Date('2099-08-01T15:30:00.000Z'),
        endsAt: new Date('2099-08-01T16:30:00.000Z'),
      }],
      update: async () => {
        throw new Error('no debe actualizar si cruza otra reserva');
      },
    },
  });

  await assert.rejects(
    () => appointmentService.updateAppointment(
      { role: 'dueno', tenantId: 't1' },
      'appt1',
      { endsAt: '2099-08-01T16:00:00.000Z' }
    ),
    (err) => err.status === 409 && /ocupada|disponibles|cruza/.test(err.message)
  );
});

test('updateAppointment permite a dueña mover una cita a horario interno ampliado', async () => {
  let updateData = null;
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
        clientId: 'c1',
        startsAt: new Date('2099-08-01T14:00:00.000Z'),
      }),
      findMany: async () => [],
      update: async ({ data }) => {
        updateData = data;
        return { id: 'appt1', ...data };
      },
    },
  });

  const result = await appointmentService.updateAppointment(
    { id: 'owner1', role: 'dueno', tenantId: 't1' },
    'appt1',
    {
      startsAt: '2099-08-02T01:30:00.000Z',
      allowOutsideBusinessHours: true,
      outsideBusinessHoursReason: 'Agenda interna ampliada',
    }
  );

  assert.equal(result.outsideBusinessHours, true);
  assert.equal(updateData.outsideBusinessHoursById, 'owner1');
  assert.match(updateData.outsideBusinessHoursReason, /Agenda interna/);
});

test('updateAppointment cambia servicio, precio y duración usando una cabina compatible', async () => {
  let updateData = null;
  mockPrisma({
    adminAuditLog: { create: async () => ({}) },
    service: {
      findFirst: async ({ where }) => where.id === 'srv2'
        ? { id: 'srv2', tenantId: 't1', category: 'facial', durationMins: 45, bufferMins: 15, priceUsd: 55 }
        : null,
    },
    room: { findMany: async () => [{ id: 'room2', specialty: 'facial', capacity: 1 }] },
    appointment: {
      findUnique: async () => ({
        id: 'appt1', tenantId: 't1', clientId: 'c1', serviceId: 'srv1', roomId: 'room1', staffId: 'staff1',
        startsAt: new Date('2099-08-01T14:00:00.000Z'), endsAt: new Date('2099-08-01T15:15:00.000Z'), priceUsd: 30,
      }),
      findMany: async () => [],
      update: async ({ data }) => {
        updateData = data;
        return { id: 'appt1', tenantId: 't1', clientId: 'c1', ...data };
      },
    },
  });

  const result = await appointmentService.updateAppointment(
    { id: 'owner1', email: 'owner@alma.test', role: 'dueno', tenantId: 't1' },
    'appt1',
    { serviceId: 'srv2', roomId: 'room2' }
  );

  assert.equal(result.serviceId, 'srv2');
  assert.equal(Number(result.priceUsd), 55);
  assert.equal(updateData.endsAt.toISOString(), '2099-08-01T15:00:00.000Z');
});

test('updateAppointment permite mover internamente una cita a una hora pasada del mismo día', async () => {
  let updateData = null;
  mockPrisma({
    adminAuditLog: { create: async () => ({}) },
    service: { findUnique: async () => ({ id: 'srv1', category: 'masajes', durationMins: 60, bufferMins: 15 }) },
    room: { findMany: async () => [{ id: 'room1', specialty: 'masajes', capacity: 1 }] },
    appointment: {
      findUnique: async () => ({
        id: 'appt1', tenantId: 't1', clientId: 'c1', serviceId: 'srv1', roomId: 'room1', staffId: 'staff1',
        startsAt: new Date('2099-08-01T13:00:00.000Z'), endsAt: new Date('2099-08-01T14:15:00.000Z'),
      }),
      findMany: async () => [],
      update: async ({ data }) => {
        updateData = data;
        return { id: 'appt1', tenantId: 't1', clientId: 'c1', ...data };
      },
    },
  });

  await withMockedNow('2099-08-01T18:00:00.000Z', async () => {
    await appointmentService.updateAppointment(
      { id: 'staff2', role: 'personal', tenantId: 't1' },
      'appt1',
      { startsAt: '2099-08-01T15:00:00.000Z' }
    );
  });

  assert.equal(updateData.startsAt.toISOString(), '2099-08-01T15:00:00.000Z');
});

test('deleteAppointment elimina dentro del tenant y conserva una auditoría con la referencia', async () => {
  let deletedId = null;
  let auditData = null;
  mockPrisma({
    appointment: {
      findUnique: async () => ({
        id: 'appt1', tenantId: 't1', clientId: 'c1', serviceId: 'srv1', roomId: 'room1', staffId: 'staff1',
        startsAt: new Date('2099-08-01T14:00:00.000Z'), endsAt: new Date('2099-08-01T15:00:00.000Z'), status: 'pendiente',
      }),
      delete: async ({ where }) => {
        deletedId = where.id;
        return { id: where.id };
      },
    },
    adminAuditLog: {
      create: async ({ data }) => {
        auditData = data;
        return data;
      },
    },
  });

  const result = await appointmentService.deleteAppointment(
    { id: 'owner1', email: 'owner@alma.test', role: 'dueno', tenantId: 't1' },
    'appt1'
  );

  assert.equal(result.id, 'appt1');
  assert.equal(deletedId, 'appt1');
  assert.equal(auditData.action, 'delete');
  assert.equal(auditData.detail.clientId, 'c1');
});

test('deleteAppointment impide eliminar una cita de otro tenant', async () => {
  let deleted = false;
  mockPrisma({
    appointment: {
      findUnique: async () => ({ id: 'appt2', tenantId: 't2' }),
      delete: async () => { deleted = true; },
    },
  });

  await assert.rejects(
    () => appointmentService.deleteAppointment(
      { id: 'owner1', email: 'owner@alma.test', role: 'dueno', tenantId: 't1' },
      'appt2'
    ),
    (err) => err.status === 403
  );
  assert.equal(deleted, false);
});
