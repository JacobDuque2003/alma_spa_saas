const prisma = require('../utils/prisma');
const { assertTenantScope, resolveTenantId } = require('../utils/tenantScope');
const { BadRequestError, SlotUnavailableError } = require('../utils/errors');
const clientService = require('./clientService');
const clientIntakeService = require('./clientIntakeService');

const STAFF_ROLES = ['personal', 'dueno'];
const OPEN_STATUSES = ['pendiente', 'confirmado'];
const DEFAULT_BUSINESS_HOURS = { start: '09:00', end: '19:00' };

function getBusinessHours(tenantConfig) {
  const bh = tenantConfig?.businessHours;
  if (bh && bh.start && bh.end) return bh;
  return DEFAULT_BUSINESS_HOURS;
}

function generateHourlySlots(dateStr, businessHours) {
  const startHour = Number(businessHours.start.split(':')[0]);
  const endHour = Number(businessHours.end.split(':')[0]);
  const slots = [];
  for (let h = startHour; h < endHour; h += 1) {
    slots.push(new Date(`${dateStr}T${String(h).padStart(2, '0')}:00:00.000Z`));
  }
  return slots;
}

async function getAvailability({ tenantId, tenantConfig, serviceId, date, modality }) {
  const mod = modality === 'domicilio' ? 'domicilio' : 'spa';

  const service = await prisma.service.findFirst({ where: { id: serviceId, tenantId, active: true } });
  if (!service) {
    throw new BadRequestError('serviceId inválido para este tenant');
  }
  if (mod === 'domicilio' && !service.offersHomeService) {
    throw new BadRequestError('Este servicio no ofrece modalidad a domicilio');
  }

  let roomIds = [];
  if (mod === 'spa') {
    const rooms = await prisma.room.findMany({ where: { tenantId, specialty: service.category, active: true } });
    roomIds = rooms.map((r) => r.id);
    if (roomIds.length === 0) return [];
  }

  const staff = await prisma.user.findMany({
    where: { tenantId, role: { in: STAFF_ROLES }, active: true, canAttendAppointments: true },
  });
  const staffIds = staff.map((s) => s.id);
  if (staffIds.length === 0) return [];

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);
  const orConditions = [{ staffId: { in: staffIds } }];
  if (roomIds.length) orConditions.push({ roomId: { in: roomIds } });

  const appointments = await prisma.appointment.findMany({
    where: { tenantId, startsAt: { gte: dayStart, lte: dayEnd }, status: { in: OPEN_STATUSES }, OR: orConditions },
  });

  const bookedRoomSlots = new Set(
    appointments.filter((a) => a.roomId).map((a) => `${a.roomId}|${a.startsAt.toISOString()}`)
  );
  const bookedStaffSlots = new Set(appointments.map((a) => `${a.staffId}|${a.startsAt.toISOString()}`));

  const businessHours = getBusinessHours(tenantConfig);
  const slots = generateHourlySlots(date, businessHours).filter((slot) => {
    const iso = slot.toISOString();
    const staffFree = staffIds.some((id) => !bookedStaffSlots.has(`${id}|${iso}`));
    if (!staffFree) return false;
    if (mod === 'domicilio') return true;
    return roomIds.some((id) => !bookedRoomSlots.has(`${id}|${iso}`));
  });

  return slots.map((s) => s.toISOString());
}

/**
 * Resuelve roomId/staffId (auto-asignación) e inserta el Appointment dentro
 * de la transacción del caller. Prueba combinaciones candidatas en orden
 * determinístico; si el insert choca contra los @@unique de Appointment
 * (P2002 — otra transacción concurrente ganó ese room/staff+horario),
 * reintenta con la siguiente combinación.
 */
async function resolveAndCreateAppointment(tx, { tenantId, clientId, serviceId, startsAt, modality, homeAddress }) {
  const mod = modality === 'domicilio' ? 'domicilio' : 'spa';

  const service = await tx.service.findFirst({ where: { id: serviceId, tenantId, active: true } });
  if (!service) {
    throw new BadRequestError('serviceId inválido para este tenant');
  }
  if (mod === 'domicilio') {
    if (!service.offersHomeService) {
      throw new BadRequestError('Este servicio no ofrece modalidad a domicilio');
    }
    if (!homeAddress) {
      throw new BadRequestError('homeAddress es requerido para modalidad domicilio');
    }
  }

  const endsAt = new Date(startsAt.getTime() + service.durationMins * 60_000);

  let roomCandidates = [];
  if (mod === 'spa') {
    roomCandidates = await tx.room.findMany({
      where: { tenantId, specialty: service.category, active: true },
      orderBy: { id: 'asc' },
    });
  }
  const staffCandidates = await tx.user.findMany({
    where: { tenantId, role: { in: STAFF_ROLES }, active: true, canAttendAppointments: true },
    orderBy: { id: 'asc' },
  });

  const orConditions = [{ staffId: { in: staffCandidates.map((s) => s.id) } }];
  if (roomCandidates.length) orConditions.push({ roomId: { in: roomCandidates.map((r) => r.id) } });

  const conflicting = await tx.appointment.findMany({
    where: { tenantId, startsAt, status: { in: OPEN_STATUSES }, OR: orConditions },
  });
  const bookedRoomIds = new Set(conflicting.filter((a) => a.roomId).map((a) => a.roomId));
  const bookedStaffIds = new Set(conflicting.map((a) => a.staffId));

  const freeRooms = mod === 'spa' ? roomCandidates.filter((r) => !bookedRoomIds.has(r.id)) : [null];
  const freeStaff = staffCandidates.filter((s) => !bookedStaffIds.has(s.id));

  if ((mod === 'spa' && freeRooms.length === 0) || freeStaff.length === 0) {
    throw new SlotUnavailableError();
  }

  for (const room of freeRooms) {
    for (const staff of freeStaff) {
      try {
        return await tx.appointment.create({
          data: {
            tenantId,
            clientId,
            serviceId,
            modality: mod,
            roomId: room ? room.id : null,
            homeAddress: mod === 'domicilio' ? homeAddress : null,
            staffId: staff.id,
            startsAt,
            endsAt,
            priceUsd: service.priceUsd,
          },
        });
      } catch (err) {
        if (err.code === 'P2002') {
          continue; // otra transacción ganó esta combinación — probar la siguiente
        }
        throw err;
      }
    }
  }
  throw new SlotUnavailableError();
}

/**
 * POST /bookings público: crea/actualiza Client, opcionalmente ClientIntake,
 * y N Appointment — todo en una sola transacción (todo o nada).
 */
async function createPublicBooking(tenantId, payload) {
  const { fullName, whatsapp, email, intake, selections } = payload;
  if (!fullName || !whatsapp) {
    throw new BadRequestError('fullName y whatsapp son requeridos');
  }
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new BadRequestError('selections es requerido y debe tener al menos un elemento');
  }

  return prisma.$transaction(async (tx) => {
    const client = await clientService.upsertClient(tx, tenantId, { fullName, whatsapp, email });

    if (intake) {
      await clientIntakeService.upsertIntake(tx, tenantId, client.id, intake);
    }

    const appointments = [];
    for (const selection of selections) {
      const appointment = await resolveAndCreateAppointment(tx, {
        tenantId,
        clientId: client.id,
        serviceId: selection.serviceId,
        startsAt: new Date(selection.startsAt),
        modality: selection.modality,
        homeAddress: selection.homeAddress,
      });
      appointments.push(appointment);
    }

    // Descartado: no se integra Google Calendar (decisión de alcance, ver CHANGELOG/MEMORY.md).
    // Alma Spa (esta Agenda) es la única fuente de verdad del calendario.
    // TODO Fase 5: enviar WhatsApp con link de confirmación (confirmationToken)

    return { client, appointments };
  });
}

async function getBookingByToken(confirmationToken) {
  const appointment = await prisma.appointment.findUnique({
    where: { confirmationToken },
    include: { service: true, tenant: { select: { name: true } } },
  });
  if (!appointment) return null;

  return {
    status: appointment.status,
    modality: appointment.modality,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    priceUsd: appointment.priceUsd,
    service: { name: appointment.service.name, category: appointment.service.category },
    tenantName: appointment.tenant.name,
  };
}

async function cancelBookingByToken(confirmationToken) {
  const appointment = await prisma.appointment.findUnique({ where: { confirmationToken } });
  if (!appointment) return null;
  if (appointment.startsAt.getTime() < Date.now()) {
    throw new BadRequestError('No se puede cancelar una cita que ya pasó');
  }
  return prisma.appointment.update({ where: { confirmationToken }, data: { status: 'cancelado' } });
}

// --- CRUD autenticado (panel de staff) ---

async function listAppointments(actor, query) {
  const where = {};
  if (actor.role === 'superadmin') {
    if (query.tenantId) where.tenantId = query.tenantId;
  } else {
    where.tenantId = actor.tenantId;
  }
  if (query.status) where.status = query.status;
  if (query.staffId) where.staffId = query.staffId;
  if (query.roomId) where.roomId = query.roomId;
  if (query.from || query.to) {
    where.startsAt = {};
    if (query.from) where.startsAt.gte = new Date(query.from);
    if (query.to) where.startsAt.lte = new Date(query.to);
  }
  return prisma.appointment.findMany({ where, orderBy: { startsAt: 'asc' } });
}

async function getAppointment(actor, id) {
  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment) return null;
  assertTenantScope(actor, appointment.tenantId);
  return appointment;
}

async function createManualAppointment(actor, data) {
  const tenantId = resolveTenantId(actor, data.tenantId);
  if (!tenantId) {
    throw new BadRequestError('tenantId es requerido');
  }
  if (!data.clientId || !data.serviceId || !data.staffId || !data.startsAt) {
    throw new BadRequestError('clientId, serviceId, staffId y startsAt son requeridos');
  }

  const service = await prisma.service.findFirst({ where: { id: data.serviceId, tenantId, active: true } });
  if (!service) {
    throw new BadRequestError('serviceId inválido para este tenant');
  }
  const modality = data.modality === 'domicilio' ? 'domicilio' : 'spa';
  if (modality === 'domicilio' && !service.offersHomeService) {
    throw new BadRequestError('Este servicio no ofrece modalidad a domicilio');
  }
  if (modality === 'spa') {
    const room = await prisma.room.findFirst({ where: { id: data.roomId, tenantId, active: true } });
    if (!room) {
      throw new BadRequestError('roomId inválido para este tenant');
    }
  }
  const staff = await prisma.user.findFirst({
    where: { id: data.staffId, tenantId, role: { in: STAFF_ROLES }, active: true, canAttendAppointments: true },
  });
  if (!staff) {
    throw new BadRequestError('staffId inválido: no es personal habilitado para atender citas en este tenant');
  }

  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(startsAt.getTime() + service.durationMins * 60_000);

  try {
    return await prisma.appointment.create({
      data: {
        tenantId,
        clientId: data.clientId,
        serviceId: data.serviceId,
        modality,
        roomId: modality === 'spa' ? data.roomId : null,
        homeAddress: modality === 'domicilio' ? data.homeAddress : null,
        staffId: data.staffId,
        startsAt,
        endsAt,
        priceUsd: service.priceUsd,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new SlotUnavailableError();
    }
    throw err;
  }
}

async function updateAppointment(actor, id, changes) {
  const target = await prisma.appointment.findUnique({ where: { id } });
  if (!target) return null;
  assertTenantScope(actor, target.tenantId);

  const data = {};
  if (changes.startsAt !== undefined) data.startsAt = new Date(changes.startsAt);
  if (changes.roomId !== undefined) data.roomId = changes.roomId;
  if (changes.staffId !== undefined) data.staffId = changes.staffId;

  if (data.startsAt) {
    const service = await prisma.service.findUnique({ where: { id: target.serviceId } });
    data.endsAt = new Date(data.startsAt.getTime() + service.durationMins * 60_000);
  }

  try {
    return await prisma.appointment.update({ where: { id }, data });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new SlotUnavailableError();
    }
    throw err;
  }
}

async function updateStatus(actor, id, status) {
  const validStatuses = ['pendiente', 'confirmado', 'cancelado', 'no_show'];
  if (!validStatuses.includes(status)) {
    throw new BadRequestError(`status debe ser uno de: ${validStatuses.join(', ')}`);
  }
  const target = await prisma.appointment.findUnique({ where: { id } });
  if (!target) return null;
  assertTenantScope(actor, target.tenantId);

  return prisma.appointment.update({ where: { id }, data: { status } });
}

module.exports = {
  getAvailability,
  createPublicBooking,
  getBookingByToken,
  cancelBookingByToken,
  listAppointments,
  getAppointment,
  createManualAppointment,
  updateAppointment,
  updateStatus,
};
