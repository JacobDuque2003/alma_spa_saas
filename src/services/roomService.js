const prisma = require('../utils/prisma');
const { assertTenantScope, resolveTenantId } = require('../utils/tenantScope');
const { BadRequestError } = require('../utils/errors');
const { pickSafe, resolveAction, writeAuditLog } = require('../utils/adminAudit');
const { validateShape } = require('../utils/businessHours');

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

async function assertSpecialtyMatchesActiveCategory(tenantId, specialty) {
  const match = await prisma.service.findFirst({
    where: { tenantId, category: specialty, active: true },
  });
  if (!match) {
    throw new BadRequestError(
      `specialty "${specialty}" no coincide con ninguna categoría de servicio activa de este tenant`
    );
  }
}

async function listRooms(actor, query) {
  const where = {};
  if (actor.role === 'superadmin') {
    if (query.tenantId) where.tenantId = query.tenantId;
  } else {
    where.tenantId = actor.tenantId;
  }
  return prisma.room.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { services: { select: { id: true, name: true, category: true, colorHex: true, durationMins: true }, orderBy: { name: 'asc' } } },
  });
}

async function getRoom(actor, id) {
  const room = await prisma.room.findUnique({
    where: { id },
    include: { services: { select: { id: true, name: true, category: true, colorHex: true, durationMins: true }, orderBy: { name: 'asc' } } },
  });
  if (!room) return null;
  assertTenantScope(actor, room.tenantId);
  return room;
}

function validateRoomSchedule(schedule) {
  if (schedule === undefined || schedule === null) return null;
  if (typeof schedule !== 'object' || Array.isArray(schedule)) {
    return 'schedule debe ser un objeto por día o null';
  }
  for (const [day, hours] of Object.entries(schedule)) {
    if (!DAY_KEYS.includes(day)) return `schedule.${day} no es un día válido`;
    const err = validateShape(hours);
    if (err) return `schedule.${day}: ${err}`;
  }
  return null;
}

async function createRoom(actor, data) {
  const tenantId = resolveTenantId(actor, data.tenantId);
  if (!tenantId) {
    throw new BadRequestError('tenantId es requerido');
  }
  if (!data.name || !data.specialty) {
    throw new BadRequestError('name y specialty son requeridos');
  }

  await assertSpecialtyMatchesActiveCategory(tenantId, data.specialty);
  const scheduleError = validateRoomSchedule(data.schedule);
  if (scheduleError) throw new BadRequestError(scheduleError);

  return prisma.$transaction(async (tx) => {
    const room = await tx.room.create({
      data: {
        tenantId,
        name: data.name,
        specialty: data.specialty,
        sortOrder: Number.isInteger(Number(data.sortOrder)) ? Number(data.sortOrder) : 0,
        opensAt: data.opensAt || '09:00',
        closesAt: data.closesAt || '20:00',
        schedule: data.schedule || null,
        status: 'libre',
        active: true,
      },
      include: { services: { select: { id: true, name: true, category: true, colorHex: true, durationMins: true }, orderBy: { name: 'asc' } } },
    });
    await writeAuditLog(tx, {
      actor,
      entity: 'room',
      entityId: room.id,
      action: 'create',
      detail: pickSafe('room', room),
    });
    return room;
  });
}

async function updateRoom(actor, id, changes) {
  const target = await prisma.room.findUnique({ where: { id } });
  if (!target) return null;
  assertTenantScope(actor, target.tenantId);

  const data = {};
  if (changes.name !== undefined) data.name = changes.name;
  if (changes.sortOrder !== undefined) {
    const n = Number(changes.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 999) throw new BadRequestError('sortOrder debe ser un entero entre 0 y 999');
    data.sortOrder = n;
  }
  if (changes.specialty !== undefined) {
    await assertSpecialtyMatchesActiveCategory(target.tenantId, changes.specialty);
    data.specialty = changes.specialty;
  }
  if (changes.schedule !== undefined) {
    const scheduleError = validateRoomSchedule(changes.schedule);
    if (scheduleError) throw new BadRequestError(scheduleError);
    data.schedule = changes.schedule;
  }
  if (changes.active !== undefined) data.active = !!changes.active;
  if (changes.status !== undefined) data.status = changes.status;
  if (changes.opensAt !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(changes.opensAt)) throw new BadRequestError('opensAt debe tener formato HH:MM');
    data.opensAt = changes.opensAt;
  }
  if (changes.closesAt !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(changes.closesAt)) throw new BadRequestError('closesAt debe tener formato HH:MM');
    data.closesAt = changes.closesAt;
  }

  if (Object.keys(data).length === 0) return target;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.room.update({
      where: { id },
      data,
      include: { services: { select: { id: true, name: true, category: true, colorHex: true, durationMins: true }, orderBy: { name: 'asc' } } },
    });
    const action = resolveAction('room', data, target);
    await writeAuditLog(tx, {
      actor,
      entity: 'room',
      entityId: id,
      action,
      detail: pickSafe('room', data),
    });
    return updated;
  });
}

async function deleteRoom(actor, id) {
  return updateRoom(actor, id, { active: false });
}

module.exports = { listRooms, getRoom, createRoom, updateRoom, deleteRoom };
