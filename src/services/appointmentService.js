const prisma = require('../utils/prisma');
const { assertTenantScope, resolveTenantId } = require('../utils/tenantScope');
const { BadRequestError, SlotUnavailableError } = require('../utils/errors');
const clientService = require('./clientService');
const clientIntakeService = require('./clientIntakeService');
const bookingNotifier = require('./bookingNotifier');
const agendaEvents = require('./crmEventBus');
const { getTenantTimezone, localDayBoundsUTC, localTimeToUTC } = require('../utils/timezone');
const { normalize: normalizeBusinessHours, isRangeInsideBusinessHours } = require('../utils/businessHours');
const {
  DAY_LABELS,
  serviceHoursForDate,
  intersectBusinessHours,
  isBusinessHoursClosed,
} = require('../utils/serviceSchedule');

const STAFF_ROLES = ['personal', 'dueno'];
const OPEN_STATUSES = ['pendiente', 'pendiente_bot', 'confirmado'];
const SERVICE_FOR_AVAILABILITY_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  category: true,
  durationMins: true,
  bufferMins: true,
  priceUsd: true,
  offersHomeService: true,
  appointmentSchedule: true,
  parentService: { select: { id: true, name: true, appointmentSchedule: true } },
};
const STAFF_FOR_APPOINTMENT_SELECT = {
  id: true,
  name: true,
  appointmentSchedule: true,
};

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
  // El schedule propio es una excepción de horario. Cabina 7 conserva su
  // jornada especial de los miércoles, pero los demás días queda disponible
  // dentro del horario normal del spa en vez de permanecer inutilizada.
  if (room?.schedule && typeof room.schedule === 'object') {
    const special = room.schedule[dayKeyFromDateStr(dateStr)];
    return special ? normalizeBusinessHours(special) : normalizeBusinessHours(tenantConfig?.businessHours);
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
      const slot = localTimeToUTC(dateStr, hhmmFromMinutes(m), timezone);
      // Nunca ofrecemos un horario que ya pasó, incluso si se consulta hoy.
      if (slot.getTime() > Date.now()) slots.push(slot);
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

function notifyAgenda(tenantId, event, appointment) {
  if (!tenantId || !appointment?.id) return;
  // Solo se envía la referencia necesaria: el panel vuelve a pedir la cita
  // desde su API autenticada, sin exponer datos de la persona por SSE.
  agendaEvents.publish(tenantId, event, {
    appointmentId: appointment.id,
    startsAt: appointment.startsAt,
    status: appointment.status,
    at: new Date().toISOString(),
  });
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

function serviceDisplayName(service) {
  return service?.name || 'este servicio';
}

async function findActiveService(db, tenantId, serviceId) {
  return db.service.findFirst({
    where: { id: serviceId, tenantId, active: true },
    select: SERVICE_FOR_AVAILABILITY_SELECT,
  });
}

function appointmentHoursForRoom(room, tenantConfig, service, dateStr) {
  const serviceDay = serviceHoursForDate(tenantConfig, service, dateStr);
  if (isBusinessHoursClosed(serviceDay.hours)) return serviceDay;
  const roomHours = roomBusinessHours(room, tenantConfig, dateStr);
  const hours = intersectBusinessHours(serviceDay.hours, roomHours);
  return {
    ...serviceDay,
    hours,
    closedReason: isBusinessHoursClosed(hours)
      ? `El horario de ${serviceDisplayName(service)} no coincide con una cabina disponible ese día.`
      : serviceDay.closedReason,
  };
}

function staffHoursForDate(tenantConfig, staff, dateStr) {
  const schedule = staff?.appointmentSchedule;
  if (!schedule || typeof schedule !== 'object') {
    return { hours: null, closedReason: null };
  }

  const dayKey = dayKeyFromDateStr(dateStr);
  if (!Object.prototype.hasOwnProperty.call(schedule, dayKey)) {
    return { hours: null, closedReason: null };
  }

  const dayValue = schedule[dayKey];
  if (dayValue === null) {
    return {
      hours: { morning: null, afternoon: null },
      closedReason: `${staff?.name || 'La terapeuta seleccionada'} no atiende citas los ${DAY_LABELS[dayKey]}.`,
    };
  }

  const base = normalizeBusinessHours(tenantConfig?.businessHours);
  const hours = intersectBusinessHours(base, normalizeBusinessHours(dayValue));
  return {
    hours,
    closedReason: isBusinessHoursClosed(hours)
      ? `El horario clínico de ${staff?.name || 'la terapeuta'} no coincide con el horario general del spa ese ${DAY_LABELS[dayKey]}.`
      : null,
  };
}

function isStaffInsideAppointmentHours(staff, tenantConfig, startsAt, endsAt) {
  const timezone = getTenantTimezone(tenantConfig);
  const startLocalDate = toLocalDateInTimezone(startsAt, timezone);
  const endLocalDate = toLocalDateInTimezone(endsAt, timezone);
  if (startLocalDate !== endLocalDate) return false;
  const hoursInfo = staffHoursForDate(tenantConfig, staff, startLocalDate);
  if (!hoursInfo.hours) return true;
  if (isBusinessHoursClosed(hoursInfo.hours)) return false;
  return isRangeInsideBusinessHours(hoursInfo.hours, localHHMM(startsAt, timezone), localHHMM(endsAt, timezone));
}

function assertInsideStaffAppointmentHours(tenantConfig, staff, startsAt, endsAt) {
  const timezone = getTenantTimezone(tenantConfig);
  const startLocalDate = toLocalDateInTimezone(startsAt, timezone);
  const endLocalDate = toLocalDateInTimezone(endsAt, timezone);
  if (startLocalDate !== endLocalDate) {
    throw new BadRequestError('La cita no puede cruzar de un día a otro para una terapeuta');
  }
  const hoursInfo = staffHoursForDate(tenantConfig, staff, startLocalDate);
  if (!hoursInfo.hours) return;
  if (isBusinessHoursClosed(hoursInfo.hours)) {
    throw new BadRequestError(hoursInfo.closedReason || 'La terapeuta seleccionada no atiende citas ese día');
  }
  if (!isRangeInsideBusinessHours(hoursInfo.hours, localHHMM(startsAt, timezone), localHHMM(endsAt, timezone))) {
    throw new BadRequestError(`La cita está fuera del horario clínico de ${staff?.name || 'la terapeuta seleccionada'}.`);
  }
}

function unavailableReason({ service, baseReason, roomIds = [], staffIds = [], hadAnyRoomWindow = false, hadAnyStaffWindow = true, hadAnySlot = false, clientId = null } = {}) {
  if (baseReason) return baseReason;
  if (roomIds.length === 0) return `Por ahora ${serviceDisplayName(service)} no tiene cabinas activas compatibles.`;
  if (staffIds.length === 0) return 'No hay terapeutas habilitadas para atender citas ese día.';
  if (!hadAnyRoomWindow) return `El horario de ${serviceDisplayName(service)} no abre una ventana suficiente con las cabinas disponibles.`;
  if (!hadAnyStaffWindow) return `Hay cabina para ${serviceDisplayName(service)}, pero ninguna terapeuta tiene horario clínico compatible ese día.`;
  if (!hadAnySlot) return `La duración de ${serviceDisplayName(service)} más su pausa no cabe dentro del horario disponible.`;
  if (clientId) return 'La persona ya tiene una cita que se cruza con los espacios libres de ese día.';
  return 'Ese día ya no queda una combinación libre de servicio, cabina y terapeuta.';
}

function assertInsideAppointmentHours(tenantConfig, service, room, startsAt, endsAt) {
  const timezone = getTenantTimezone(tenantConfig);
  const startLocalDate = toLocalDateInTimezone(startsAt, timezone);
  const endLocalDate = toLocalDateInTimezone(endsAt, timezone);
  if (startLocalDate !== endLocalDate) {
    throw new BadRequestError(`La cita de ${serviceDisplayName(service)} no puede cruzar de un día a otro`);
  }
  const hoursInfo = appointmentHoursForRoom(room, tenantConfig, service, startLocalDate);
  if (isBusinessHoursClosed(hoursInfo.hours)) {
    throw new BadRequestError(hoursInfo.closedReason || `Ese día ${serviceDisplayName(service)} no tiene horario disponible`);
  }
  const startHHMM = localHHMM(startsAt, timezone);
  const endHHMM = localHHMM(endsAt, timezone);
  if (!isRangeInsideBusinessHours(hoursInfo.hours, startHHMM, endHHMM)) {
    throw new BadRequestError(`La cita está fuera del horario disponible para ${serviceDisplayName(service)}. Debe quedar dentro del horario del spa, del servicio y de la cabina.`);
  }
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

async function getAvailabilityDetails({ tenantId, tenantConfig, serviceId, date, modality, clientId = null }) {
  if (isHomeModality(modality)) {
    throw new BadRequestError('La modalidad a domicilio no está disponible');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    throw new BadRequestError('date debe tener formato YYYY-MM-DD');
  }
  const service = await findActiveService(prisma, tenantId, serviceId);
  if (!service) {
    throw new BadRequestError('serviceId inválido para este tenant');
  }
  const serviceDay = serviceHoursForDate(tenantConfig, service, date);
  const rooms = await getCompatibleRooms(prisma, tenantId, service);
  const roomIds = rooms.map((r) => r.id);
  if (roomIds.length === 0) {
    return { slots: [], emptyReason: unavailableReason({ service, roomIds }) };
  }

  const staff = await prisma.user.findMany({
    where: { tenantId, role: { in: STAFF_ROLES }, active: true, canAttendAppointments: true },
    select: STAFF_FOR_APPOINTMENT_SELECT,
  });
  const staffIds = staff.map((s) => s.id);
  if (staffIds.length === 0) {
    return { slots: [], emptyReason: unavailableReason({ service, roomIds, staffIds }) };
  }

  if (isBusinessHoursClosed(serviceDay.hours)) {
    return { slots: [], emptyReason: unavailableReason({ service, baseReason: serviceDay.closedReason, roomIds, staffIds }) };
  }

  const tz = getTenantTimezone(tenantConfig);
  const { dayStart, dayEnd } = localDayBoundsUTC(date, tz);
  const orConditions = [{ staffId: { in: staffIds } }];
  if (roomIds.length) orConditions.push({ roomId: { in: roomIds } });
  if (clientId) orConditions.push({ clientId });

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
  let hadAnyRoomWindow = false;
  let hadAnyStaffWindow = false;
  let hadAnySlot = false;
  for (const room of rooms) {
    const hoursInfo = appointmentHoursForRoom(room, tenantConfig, service, date);
    const businessHours = hoursInfo.hours;
    if (isBusinessHoursClosed(businessHours)) continue;
    hadAnyRoomWindow = true;
    for (const slot of generateSlotsForService(date, businessHours, tz, service)) {
      hadAnySlot = true;
      const blockedEnd = addMinutes(slot, totalBlockMins(service));
      const roomFree = isResourceFree(appointments, 'roomId', room.id, slot, blockedEnd);
      const staffInsideWindow = staff.filter((person) => isStaffInsideAppointmentHours(person, tenantConfig, slot, blockedEnd));
      if (staffInsideWindow.length > 0) hadAnyStaffWindow = true;
      const staffFree = staffInsideWindow.some((person) => isResourceFree(appointments, 'staffId', person.id, slot, blockedEnd));
      const clientFree = !clientId || isResourceFree(appointments, 'clientId', clientId, slot, blockedEnd);
      if (roomFree && staffFree && clientFree) slotMap.set(slot.toISOString(), slot);
    }
  }

  const slots = [...slotMap.values()].sort((a, b) => a - b).map((s) => s.toISOString());
  return {
    slots,
    emptyReason: slots.length ? null : unavailableReason({ service, roomIds, staffIds, hadAnyRoomWindow, hadAnyStaffWindow, hadAnySlot, clientId }),
  };
}

async function getAvailability(args) {
  const result = await getAvailabilityDetails(args);
  return result.slots;
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
  const result = await getRescheduleAvailabilityDetails({ tenantId, tenantConfig, appointmentId, date, roomId, staffId });
  return result.slots;
}

async function getRescheduleAvailabilityDetails({ tenantId, tenantConfig, appointmentId, date, roomId, staffId }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    throw new BadRequestError('date debe tener formato YYYY-MM-DD');
  }

  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  if (!appointment || appointment.tenantId !== tenantId) {
    throw new BadRequestError('Cita no encontrada');
  }

  const service = await findActiveService(prisma, tenantId, appointment.serviceId);
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
    select: STAFF_FOR_APPOINTMENT_SELECT,
  });
  if (!staff) {
    return { slots: [], emptyReason: 'La terapeuta asignada ya no está habilitada para atender citas.' };
  }

  const serviceDay = serviceHoursForDate(tenantConfig, service, date);
  if (isBusinessHoursClosed(serviceDay.hours)) {
    return { slots: [], emptyReason: serviceDay.closedReason || `Ese día ${serviceDisplayName(service)} no tiene horario disponible.` };
  }

  const tz = getTenantTimezone(tenantConfig);
  const { dayStart, dayEnd } = localDayBoundsUTC(date, tz);
  const appointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      id: { not: appointment.id },
      startsAt: { lt: dayEnd },
      endsAt: { gt: dayStart },
      status: { in: OPEN_STATUSES },
      OR: [{ roomId: room.id }, { staffId: staff.id }, { clientId: appointment.clientId }],
    },
  });

  const slots = [];
  const hoursInfo = appointmentHoursForRoom(room, tenantConfig, service, date);
  const businessHours = hoursInfo.hours;
  let hadAnySlot = false;
  for (const slot of generateSlotsForService(date, businessHours, tz, service)) {
    hadAnySlot = true;
    const endsAt = addMinutes(slot, totalBlockMins(service));
    if (
      isResourceFree(appointments, 'roomId', room.id, slot, endsAt)
      && isStaffInsideAppointmentHours(staff, tenantConfig, slot, endsAt)
      && isResourceFree(appointments, 'staffId', staff.id, slot, endsAt)
      && isResourceFree(appointments, 'clientId', appointment.clientId, slot, endsAt)
    ) {
      slots.push(slot.toISOString());
    }
  }
  return {
    slots,
    emptyReason: slots.length
      ? null
      : (hoursInfo.closedReason || staffHoursForDate(tenantConfig, staff, date).closedReason || (hadAnySlot
        ? 'La cabina, terapeuta o clienta ya tiene un cruce con los espacios libres de ese día.'
        : `La duración de ${serviceDisplayName(service)} más su pausa no cabe dentro del horario disponible.`)),
  };
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
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
    throw new BadRequestError('No se puede reservar una fecha u horario que ya pasó');
  }
  const mod = 'spa';

  const service = await findActiveService(tx, tenantId, serviceId);
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
    select: STAFF_FOR_APPOINTMENT_SELECT,
    orderBy: { id: 'asc' },
  });

  const orConditions = [{ staffId: { in: staffCandidates.map((s) => s.id) } }];
  if (roomCandidates.length) orConditions.push({ roomId: { in: roomCandidates.map((r) => r.id) } });
  orConditions.push({ clientId });

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
    const hours = appointmentHoursForRoom(r, tenantConfig, service, dateStr).hours;
    return isRangeInsideBusinessHours(hours, localHHMM(startsAt, getTenantTimezone(tenantConfig)), localHHMM(endsAt, getTenantTimezone(tenantConfig)));
  });
  if (roomsInsideWindow.length === 0) {
    const serviceDay = serviceHoursForDate(tenantConfig, service, dateStr);
    throw new BadRequestError(serviceDay.closedReason || `La cita está fuera del horario disponible para ${serviceDisplayName(service)}.`);
  }
  const freeRooms = roomsInsideWindow.filter((r) => isResourceFree(conflicting, 'roomId', r.id, startsAt, endsAt));
  const staffInsideWindow = staffCandidates.filter((s) => isStaffInsideAppointmentHours(s, tenantConfig, startsAt, endsAt));
  const freeStaff = staffInsideWindow.filter((s) => isResourceFree(conflicting, 'staffId', s.id, startsAt, endsAt));

  if (!isResourceFree(conflicting, 'clientId', clientId, startsAt, endsAt)) {
    throw new SlotUnavailableError('La persona ya tiene una cita que se cruza con ese horario');
  }

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

  result.appointments.forEach((appointment) => notifyAgenda(tenantId, 'appointment.created', appointment));

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
  const updated = await prisma.appointment.update({ where: { confirmationToken }, data: { status: 'cancelado' } });
  notifyAgenda(updated.tenantId, 'appointment.status.updated', updated);
  return updated;
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
  const updated = await prisma.appointment.update({ where: { confirmationToken }, data: { status: 'confirmado' } });
  notifyAgenda(updated.tenantId, 'appointment.status.updated', updated);
  return updated;
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

  // C-1: validar clientId contra tenantId ANTES de crear la cita — sin este
  // guard, un dueño puede crear una cita con un clientId de OTRO tenant y
  // luego ver PII (nombre/whatsapp/ficha) al listar. Igual patrón que
  // service/staff: findFirst scopeado por tenant, respuesta 400 uniforme
  // para "no existe" y "otro tenant" (anti-enumeración).
  const client = await prisma.client.findFirst({ where: { id: data.clientId, tenantId } });
  if (!client) {
    throw new BadRequestError('clientId invalido para este tenant');
  }

  const service = await findActiveService(prisma, tenantId, data.serviceId);
  if (!service) {
    throw new BadRequestError('serviceId invalido para este tenant');
  }
  if (isHomeModality(data.modality) || isHomeModality(data.location)) {
    throw new BadRequestError('La modalidad a domicilio no está disponible');
  }
  const modality = 'spa';

  const staff = await prisma.user.findFirst({
    where: { id: data.staffId, tenantId, role: { in: STAFF_ROLES }, active: true, canAttendAppointments: true },
    select: STAFF_FOR_APPOINTMENT_SELECT,
  });
  if (!staff) {
    throw new BadRequestError('staffId invalido: no es personal habilitado para atender citas en este tenant');
  }

  const startsAt = new Date(data.startsAt);
  if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
    throw new BadRequestError('No se puede reservar una fecha u horario que ya pasó');
  }
  const endsAt = addMinutes(startsAt, totalBlockMins(service));
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { config: true } });
  assertInsideStaffAppointmentHours(tenant?.config, staff, startsAt, endsAt);
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
        { clientId: data.clientId },
      ],
    },
  });
  if (!isResourceFree(conflicting, 'staffId', staff.id, startsAt, endsAt)) {
    throw new SlotUnavailableError('La terapeuta seleccionada ya está ocupada en ese horario');
  }
  if (!isResourceFree(conflicting, 'clientId', data.clientId, startsAt, endsAt)) {
    throw new SlotUnavailableError('La persona ya tiene una cita que se cruza con ese horario');
  }

  let resolvedRoomId = null;
  if (data.roomId) {
    const room = roomCandidates.find((r) => r.id === data.roomId);
    if (!room) {
      throw new BadRequestError('La cabina seleccionada no corresponde al servicio');
    }
    assertInsideAppointmentHours(tenant?.config, service, room, startsAt, endsAt);
    if (!isResourceFree(conflicting, 'roomId', room.id, startsAt, endsAt)) {
      throw new SlotUnavailableError('La cabina seleccionada ya está ocupada en ese horario');
    }
    resolvedRoomId = room.id;
  } else {
    const roomsInsideWindow = roomCandidates.filter((r) => {
      const hours = appointmentHoursForRoom(r, tenant?.config, service, dateStr).hours;
      return isRangeInsideBusinessHours(hours, localHHMM(startsAt, getTenantTimezone(tenant?.config)), localHHMM(endsAt, getTenantTimezone(tenant?.config)));
    });
    if (roomsInsideWindow.length === 0) {
      const serviceDay = serviceHoursForDate(tenant?.config, service, dateStr);
      throw new BadRequestError(serviceDay.closedReason || `La cita está fuera del horario disponible para ${serviceDisplayName(service)}.`);
    }
    const freeRoom = roomsInsideWindow.find((r) => isResourceFree(conflicting, 'roomId', r.id, startsAt, endsAt));
    if (!freeRoom) {
      throw new SlotUnavailableError();
    }
    resolvedRoomId = freeRoom.id;
  }

  try {
    const appointment = await prisma.appointment.create({
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
    notifyAgenda(tenantId, 'appointment.created', appointment);
    return appointment;
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
  if (changes.staffId !== undefined) {
    // M-3: validar staffId contra target.tenantId — sin esto, un dueño puede
    // asignar staffId de OTRO tenant y filtrar staff.name al listar.
    const staff = await prisma.user.findFirst({
      where: {
        id: changes.staffId,
        tenantId: target.tenantId,
        role: { in: STAFF_ROLES },
        active: true,
        canAttendAppointments: true,
      },
      select: STAFF_FOR_APPOINTMENT_SELECT,
    });
    if (!staff) {
      throw new BadRequestError('staffId invalido: no es personal habilitado para atender citas en este tenant');
    }
    data.staffId = changes.staffId;
  }
  if (changes.indications !== undefined) data.indications = changes.indications ? String(changes.indications).trim() : null;

  if (data.startsAt || data.roomId !== undefined || data.staffId !== undefined) {
    const service = await prisma.service.findUnique({
      where: { id: target.serviceId },
      select: SERVICE_FOR_AVAILABILITY_SELECT,
    });
    const startsAt = data.startsAt || target.startsAt;
    if (data.startsAt && (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now())) {
      throw new BadRequestError('No se puede reprogramar a una fecha u horario que ya pasó');
    }
    const endsAt = addMinutes(startsAt, totalBlockMins(service));
    data.endsAt = endsAt;
    const tenant = await prisma.tenant.findUnique({ where: { id: target.tenantId }, select: { config: true } });
    const dateStr = toLocalDateInTimezone(startsAt, getTenantTimezone(tenant?.config));
    const roomId = data.roomId !== undefined ? data.roomId : target.roomId;
    const staffId = data.staffId !== undefined ? data.staffId : target.staffId;
    const staff = await prisma.user.findFirst({
      where: {
        id: staffId,
        tenantId: target.tenantId,
        role: { in: STAFF_ROLES },
        active: true,
        canAttendAppointments: true,
      },
      select: STAFF_FOR_APPOINTMENT_SELECT,
    });
    if (!staff) {
      throw new BadRequestError('staffId invalido: no es personal habilitado para atender citas en este tenant');
    }
    const roomCandidates = await getCompatibleRooms(prisma, target.tenantId, service);
    const room = roomCandidates.find((r) => r.id === roomId);
    if (!room) throw new BadRequestError('La cabina seleccionada no corresponde al servicio');
    assertInsideAppointmentHours(tenant?.config, service, room, startsAt, endsAt);
    assertInsideStaffAppointmentHours(tenant?.config, staff, startsAt, endsAt);

    const conflicting = await prisma.appointment.findMany({
      where: {
        tenantId: target.tenantId,
        id: { not: id },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        status: { in: OPEN_STATUSES },
        OR: [{ roomId }, { staffId }, { clientId: target.clientId }],
      },
    });
    if (!isResourceFree(conflicting, 'staffId', staffId, startsAt, endsAt)) {
      throw new SlotUnavailableError('La terapeuta seleccionada ya está ocupada en ese horario');
    }
    if (!isResourceFree(conflicting, 'roomId', roomId, startsAt, endsAt)) {
      throw new SlotUnavailableError('La cabina seleccionada ya está ocupada en ese horario');
    }
    if (!isResourceFree(conflicting, 'clientId', target.clientId, startsAt, endsAt)) {
      throw new SlotUnavailableError('La persona ya tiene una cita que se cruza con ese horario');
    }
  }

  try {
    const appointment = await prisma.appointment.update({ where: { id }, data });
    notifyAgenda(target.tenantId, 'appointment.updated', appointment);
    return appointment;
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

  const appointment = await prisma.appointment.update({ where: { id }, data: { status } });
  notifyAgenda(target.tenantId, 'appointment.status.updated', appointment);
  return appointment;
}

module.exports = {
  getAvailability,
  getAvailabilityDetails,
  getRescheduleAvailability,
  getRescheduleAvailabilityDetails,
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
