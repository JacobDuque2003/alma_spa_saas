const prisma = require('../utils/prisma');
const { assertTenantScope, resolveTenantId } = require('../utils/tenantScope');
const { BadRequestError, SlotUnavailableError } = require('../utils/errors');
const clientService = require('./clientService');
const clientIntakeService = require('./clientIntakeService');
const bookingNotifier = require('./bookingNotifier');
const { getTenantTimezone, localDayBoundsUTC, localTimeToUTC } = require('../utils/timezone');
const { normalize: normalizeBusinessHours, isRangeInsideBusinessHours } = require('../utils/businessHours');

const STAFF_ROLES = ['personal', 'dueno'];
const OPEN_STATUSES = ['pendiente', 'pendiente_bot', 'confirmado'];

function getBusinessHours(tenantConfig) {
  return normalizeBusinessHours(tenantConfig?.businessHours);
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SLOT_STEP_MINS = 15;

function minutesFromHHMM(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function hhmmFromMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60_000);
}

function totalBlockMins(service) {
  return Number(service.durationMins || 60) + Number(service.bufferMins ?? 15);
}

function dayKeyFromDateStr(dateStr) {
  return DAY_KEYS[new Date(`${dateStr}T12:00:00`).getDay()];
}

function roomBusinessHours(room, tenantConfig, dateStr) {
  // Una cabina con schedule propio (ej. Cabina 7 - TERAPIAS, solo miércoles)
  // opera EXCLUSIVAMENTE los días listados ahí. Un día ausente de ese
  // schedule significa cerrada ese día, no "usa el horario general del
  // tenant" — normalizeBusinessHours(undefined) devolvería el default
  // hardcodeado, que no es lo que queremos aquí.
  if (room?.schedule && typeof room.schedule === 'object') {
    const special = room.schedule[dayKeyFromDateStr(dateStr)];
    return special ? normalizeBusinessHours(special) : { morning: null, afternoon: null };
  }
  return normalizeBusinessHours(tenantConfig?.businessHours);
}

function generateSlotsForService(dateStr, businessHours, timezone, service) {
  const slots = [];
  const normalized = normalizeBusinessHours(businessHours);
  const blockMins = totalBlockMins(service);
  for (const win of [normalized.morning, normalized.afternoon]) {
    if (!win) continue;
    const start = minutesFromHHMM(win.start);
    const latest = minutesFromHHMM(win.end) - blockMins;
    for (let m = start; m <= latest; m += SLOT_STEP_MINS) {
      slots.push(localTimeToUTC(dateStr, hhmmFromMinutes(m), timezone));
    }
  }
  return slots;
}

function isHomeModality(value) {
  return ['domicilio', 'home', 'a_domicilio'].includes(String(value || '').toLowerCase());
}

function localHHMM(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hour = map.hour === '24' ? '00' : map.hour;
  return `${hour}:${map.minute}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function isResourceFree(appointments, resourceKey, resourceId, start, end) {
  return !appointments.some((a) => a[resourceKey] === resourceId && overlaps(a.startsAt, a.endsAt, start, end));
}

async function getCompatibleRooms(db, tenantId, service) {
  const linkedRooms = await db.room.findMany({
    where: { tenantId, active: true, services: { some: { id: service.id } } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  if (linkedRooms.length > 0) return linkedRooms;

  // Fallback temporal para servicios anteriores a la migración:
  // categoría del servicio = specialty de cabina.
  return db.room.findMany({
    where: { tenantId, specialty: service.category, active: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
}

function assertInsideBusinessHours(tenantConfig, startsAt, endsAt, businessHoursOverride) {
  const timezone = getTenantTimezone(tenantConfig);
  const startLocalDate = toLocalDateInTimezone(startsAt, timezone);
  const endLocalDate = toLocalDateInTimezone(endsAt, timezone);
  if (startLocalDate !== endLocalDate) {
    throw new BadRequestError('La cita está fuera del horario de atención');
  }
  if (!isRangeInsideBusinessHours(businessHoursOverride || getBusinessHours(tenantConfig), localHHMM(startsAt, timezone), localHHMM(endsAt, timezone))) {
    throw new BadRequestError('La cita está fuera del horario de atención');
  }
}

function toLocalDateInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function getAvailability({ tenantId, tenantConfig, serviceId, date, modality }) {
  if (isHomeModality(modality)) {
    throw new BadRequestError('La modalidad a domicilio no está disponible');
  }
  const service = await prisma.service.findFirst({ where: { id: serviceId, tenantId, active: true } });
  if (!service) {
    throw new BadRequestError('serviceId inválido para este tenant');
  }
  const rooms = await getCompatibleRooms(prisma, tenantId, service);
  const roomIds = rooms.map((r) => r.id);
  if (roomIds.length === 0) return [];

  const staff = await prisma.user.findMany({
    where: { tenantId, role: { in: STAFF_ROLES }, active: true, canAttendAppointments: true },
  });
  const staffIds = staff.map((s) => s.id);
  if (staffIds.length === 0) return [];

  const tz = getTenantTimezone(tenantConfig);
  const { dayStart, dayEnd } = localDayBoundsUTC(date, tz);
  const orConditions = [{ staffId: { in: staffIds } }];
  if (roomIds.length) orConditions.push({ roomId: { in: roomIds } });

  const appointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      startsAt: { lt: dayEnd },
      endsAt: { gt: dayStart },
      status: { in: OPEN_STATUSES },
      OR: orConditions,
    },
  });

  const slotMap = new Map();
  for (const room of rooms) {
    const businessHours = roomBusinessHours(room, tenantConfig, date);
    for (const slot of generateSlotsForService(date, businessHours, tz, service)) {
      const blockedEnd = addMinutes(slot, totalBlockMins(service));
      const roomFree = isResourceFree(appointments, 'roomId', room.id, slot, blockedEnd);
      const staffFree = staffIds.some((id) => isResourceFree(appointments, 'staffId', id, slot, blockedEnd));
      if (roomFree && staffFree) slotMap.set(slot.toISOString(), slot);
    }
  }

  return [...slotMap.values()].sort((a, b) => a - b).map((s) => s.toISOString());
}

/**
 * Horarios que puede tomar una cita existente al reprogramarse.
 *
 * A diferencia de la disponibilidad para una reserva nueva, conserva la
 * cabina y terapeuta elegidos (o los cambios explícitos del panel), excluye
 * la cita actual de los conflictos y aplica exactamente el mismo bloque del
 * servicio: duración + pausa, horario de la cabina y zona del tenant.
 */
async function getRescheduleAvailability({ tenantId, tenantConfig, appointmentId, date, roomId, staffId }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    throw new BadRequestError('date debe tener formato YYYY-MM-DD');
  }

  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment || appointment.tenantId !== tenantId) {
    throw new BadRequestError('Cita no encontrada');
  }

  const service = await prisma.service.findFirst({
    where: { id: appointment.serviceId, tenantId, active: true },
  });
  if (!service) {
    throw new BadRequestError('El servicio de esta cita ya no está disponible');
  }

  const roomCandidates = await getCompatibleRooms(prisma, tenantId, service);
  const selectedRoomId = roomId || appointment.roomId;
  const room = roomCandidates.find((candidate) => candidate.id === selectedRoomId);
  if (!room) {
    throw new BadRequestError('La cabina seleccionada no corresponde al servicio');
  }

  const selectedStaffId = staffId || appointment.staffId;
  const staff = await prisma.user.findFirst({
    where: {
      id: selectedStaffId,
      tenantId,
      role: { in: STAFF_ROLES },
      active: true,
      canAttendAppointments: true,
    },
  });
  if (!staff) return [];

  const tz = getTenantTimezone(tenantConfig);
  const { dayStart, dayEnd } = localDayBoundsUTC(date, tz);
  const appointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      id: { not: appointment.id },
      startsAt: { lt: dayEnd },
      endsAt: { gt: dayStart },
      status: { in: OPEN_STATUSES },
      OR: [{ roomId: room.id }, { staffId: staff.id }],
    },
  });

  const slots = [];
  const businessHours = roomBusinessHours(room, tenantConfig, date);
  for (const slot of generateSlotsForService(date, businessHours, tz, service)) {
    const endsAt = addMinutes(slot, totalBlockMins(service));
    if (
      isResourceFree(appointments, 'roomId', room.id, slot, endsAt)
      && isResourceFree(appointments, 'staffId', staff.id, slot, endsAt)
    ) {
      slots.push(slot.toISOString());
    }
  }
  return slots;
}

/**
 * Resuelve roomId/staffId (auto-asignación) e inserta el Appointment dentro
 * de la transacción del caller. Prueba combinaciones candidatas en orden
 * determinístico; si el insert choca contra los @@unique de Appointment
 * (P2002 — otra transacción concurrente ganó ese room/staff+horario),
 * reintenta con la siguiente combinación.
 */
async function resolveAndCreateAppointment(tx, { tenantId, tenantConfig, clientId, serviceId, startsAt, modality, status }) {
  if (isHomeModality(modality)) {
    throw new BadRequestError('La modalidad a domicilio no está disponible');
  }
  const mod = 'spa';

  const service = await tx.service.findFirst({ where: { id: serviceId, tenantId, active: true } });
  if (!service) {
    throw new BadRequestError('serviceId inválido para este tenant');
  }
  const endsAt = addMinutes(startsAt, totalBlockMins(service));

  const roomCandidates = await getCompatibleRooms(tx, tenantId, service);
  if (roomCandidates.length === 0) {
    throw new SlotUnavailableError();
  }
  const staffCandidates = await tx.user.findMany({
    where: { tenantId, role: { in: STAFF_ROLES }, active: true, canAttendAppointments: true },
    orderBy: { id: 'asc' },
  });

  const orConditions = [{ staffId: { in: staffCandidates.map((s) => s.id) } }];
  if (roomCandidates.length) orConditions.push({ roomId: { in: roomCandidates.map((r) => r.id) } });

  const conflicting = await tx.appointment.findMany({
    where: {
      tenantId,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      status: { in: OPEN_STATUSES },
      OR: orConditions,
    },
  });
  const dateStr = toLocalDateInTimezone(startsAt, getTenantTimezone(tenantConfig));
  const roomsInsideWindow = roomCandidates.filter((r) => {
    const hours = roomBusinessHours(r, tenantConfig, dateStr);
    return isRangeInsideBusinessHours(hours, localHHMM(startsAt, getTenantTimezone(tenantConfig)), localHHMM(endsAt, getTenantTimezone(tenantConfig)));
  });
  if (roomsInsideWindow.length === 0) {
    throw new BadRequestError('La cita está fuera del horario de atención');
  }
  const freeRooms = roomsInsideWindow.filter((r) => isResourceFree(conflicting, 'roomId', r.id, startsAt, endsAt));
  const freeStaff = staffCandidates.filter((s) => isResourceFree(conflicting, 'staffId', s.id, startsAt, endsAt));

  if (freeRooms.length === 0 || freeStaff.length === 0) {
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
            roomId: room.id,
            homeAddress: null,
            staffId: staff.id,
            startsAt,
            endsAt,
            priceUsd: service.priceUsd,
            ...(status ? { status } : {}),
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
  const { fullName, whatsapp, email, address, intake, selections } = payload;
  if (!fullName || !whatsapp) {
    throw new BadRequestError('fullName y whatsapp son requeridos');
  }
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new BadRequestError('selections es requerido y debe tener al menos un elemento');
  }

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { config: true } });
    const client = await clientService.upsertClient(tx, tenantId, { fullName, whatsapp, email, address });

    if (intake) {
      await clientIntakeService.upsertIntake(tx, tenantId, client.id, intake);
    }

    const appointments = [];
    for (const selection of selections) {
      const appointment = await resolveAndCreateAppointment(tx, {
        tenantId,
        tenantConfig: tenant?.config,
        clientId: client.id,
        serviceId: selection.serviceId,
        startsAt: new Date(selection.startsAt),
        modality: selection.modality,
      });
      appointments.push(appointment);
    }

    // Descartado: no se integra Google Calendar (decisión de alcance, ver CHANGELOG/MEMORY.md).
    // Alma Spa (esta Agenda) es la única fuente de verdad del calendario.
    return { client, appointments };
  });

  // Fase 5: enviar plantilla de WhatsApp con link de confirmación. Fuera de la
  // transacción a propósito — una API externa lenta no debe mantener el lock
  // de la DB abierto, y un fallo de Meta jamás debe revertir un booking ya
  // commiteado. Best-effort: bookingNotifier atrapa todo y loguea.
  bookingNotifier.notifyBookingCreated(tenantId, result.client, result.appointments)
    .catch((err) => console.warn('[BOOKING-NOTIFIER] catch externo:', err?.message));

  return result;
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

async function confirmBookingByToken(confirmationToken) {
  const appointment = await prisma.appointment.findUnique({ where: { confirmationToken } });
  if (!appointment) return null;
  if (appointment.startsAt.getTime() < Date.now()) {
    throw new BadRequestError('No se puede confirmar una cita que ya pasó');
  }
  if (appointment.status === 'cancelado' || appointment.status === 'no_show') {
    throw new BadRequestError('Esta cita ya no puede confirmarse');
  }
  if (appointment.status === 'confirmado') {
    return appointment; // idempotente
  }
  return prisma.appointment.update({ where: { confirmationToken }, data: { status: 'confirmado' } });
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
  if (query.clientId) where.clientId = query.clientId;
  if (query.staffId) where.staffId = query.staffId;
  if (query.roomId) where.roomId = query.roomId;
  if (query.from || query.to) {
    where.startsAt = {};
    if (query.from) where.startsAt.gte = new Date(query.from);
    if (query.to) where.startsAt.lte = new Date(query.to);
  }
  return prisma.appointment.findMany({
    where,
    orderBy: { startsAt: 'asc' },
    include: {
      service: { select: { name: true, category: true, durationMins: true, bufferMins: true, colorHex: true } },
      client:  { select: { id: true, fullName: true, whatsapp: true, recordNumber: true } },
      room:    { select: { id: true, name: true, sortOrder: true } },
      staff:   { select: { id: true, name: true } },
    },
  });
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
    throw new BadRequestError('serviceId invalido para este tenant');
  }
  if (isHomeModality(data.modality) || isHomeModality(data.location)) {
    throw new BadRequestError('La modalidad a domicilio no está disponible');
  }
  const modality = 'spa';

  const staff = await prisma.user.findFirst({
    where: { id: data.staffId, tenantId, role: { in: STAFF_ROLES }, active: true, canAttendAppointments: true },
  });
  if (!staff) {
    throw new BadRequestError('staffId invalido: no es personal habilitado para atender citas en este tenant');
  }

  const startsAt = new Date(data.startsAt);
  const endsAt = addMinutes(startsAt, totalBlockMins(service));
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { config: true } });
  const dateStr = toLocalDateInTimezone(startsAt, getTenantTimezone(tenant?.config));
  const roomCandidates = await getCompatibleRooms(prisma, tenantId, service);
  if (roomCandidates.length === 0) {
    throw new SlotUnavailableError();
  }

  const conflicting = await prisma.appointment.findMany({
    where: {
      tenantId,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      status: { in: OPEN_STATUSES },
      OR: [
        { staffId: staff.id },
        { roomId: { in: roomCandidates.map((r) => r.id) } },
      ],
    },
  });
  if (!isResourceFree(conflicting, 'staffId', staff.id, startsAt, endsAt)) {
    throw new SlotUnavailableError('La terapeuta seleccionada ya está ocupada en ese horario');
  }

  let resolvedRoomId = null;
  if (data.roomId) {
    const room = roomCandidates.find((r) => r.id === data.roomId);
    if (!room) {
      throw new BadRequestError('La cabina seleccionada no corresponde al servicio');
    }
    assertInsideBusinessHours(tenant?.config, startsAt, endsAt, roomBusinessHours(room, tenant?.config, dateStr));
    if (!isResourceFree(conflicting, 'roomId', room.id, startsAt, endsAt)) {
      throw new SlotUnavailableError('La cabina seleccionada ya está ocupada en ese horario');
    }
    resolvedRoomId = room.id;
  } else {
    const roomsInsideWindow = roomCandidates.filter((r) => {
      const hours = roomBusinessHours(r, tenant?.config, dateStr);
      return isRangeInsideBusinessHours(hours, localHHMM(startsAt, getTenantTimezone(tenant?.config)), localHHMM(endsAt, getTenantTimezone(tenant?.config)));
    });
    if (roomsInsideWindow.length === 0) {
      throw new BadRequestError('La cita está fuera del horario de atención');
    }
    const freeRoom = roomsInsideWindow.find((r) => isResourceFree(conflicting, 'roomId', r.id, startsAt, endsAt));
    if (!freeRoom) {
      throw new SlotUnavailableError();
    }
    resolvedRoomId = freeRoom.id;
  }

  try {
    return await prisma.appointment.create({
      data: {
        tenantId,
        clientId: data.clientId,
        serviceId: data.serviceId,
        modality,
        roomId: resolvedRoomId,
        homeAddress: null,
        staffId: data.staffId,
        startsAt,
        endsAt,
        status: 'confirmado',
        indications: data.indications ? String(data.indications).trim() : null,
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
  if (changes.indications !== undefined) data.indications = changes.indications ? String(changes.indications).trim() : null;

  if (data.startsAt || data.roomId !== undefined || data.staffId !== undefined) {
    const service = await prisma.service.findUnique({ where: { id: target.serviceId } });
    const startsAt = data.startsAt || target.startsAt;
    const endsAt = addMinutes(startsAt, totalBlockMins(service));
    data.endsAt = endsAt;
    const tenant = await prisma.tenant.findUnique({ where: { id: target.tenantId }, select: { config: true } });
    const dateStr = toLocalDateInTimezone(startsAt, getTenantTimezone(tenant?.config));
    const roomId = data.roomId !== undefined ? data.roomId : target.roomId;
    const staffId = data.staffId !== undefined ? data.staffId : target.staffId;
    const roomCandidates = await getCompatibleRooms(prisma, target.tenantId, service);
    const room = roomCandidates.find((r) => r.id === roomId);
    if (!room) throw new BadRequestError('La cabina seleccionada no corresponde al servicio');
    assertInsideBusinessHours(tenant?.config, startsAt, endsAt, roomBusinessHours(room, tenant?.config, dateStr));

    const conflicting = await prisma.appointment.findMany({
      where: {
        tenantId: target.tenantId,
        id: { not: id },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        status: { in: OPEN_STATUSES },
        OR: [{ roomId }, { staffId }],
      },
    });
    if (!isResourceFree(conflicting, 'staffId', staffId, startsAt, endsAt)) {
      throw new SlotUnavailableError('La terapeuta seleccionada ya está ocupada en ese horario');
    }
    if (!isResourceFree(conflicting, 'roomId', roomId, startsAt, endsAt)) {
      throw new SlotUnavailableError('La cabina seleccionada ya está ocupada en ese horario');
    }
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
  const validStatuses = ['pendiente', 'pendiente_bot', 'confirmado', 'cancelado', 'no_show'];
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
  getRescheduleAvailability,
  resolveAndCreateAppointment,
  createPublicBooking,
  getBookingByToken,
  cancelBookingByToken,
  confirmBookingByToken,
  listAppointments,
  getAppointment,
  createManualAppointment,
  updateAppointment,
  updateStatus,
};
