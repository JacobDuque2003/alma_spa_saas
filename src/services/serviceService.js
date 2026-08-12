const prisma = require('../utils/prisma');
const { assertTenantScope, resolveTenantId } = require('../utils/tenantScope');
const { BadRequestError } = require('../utils/errors');
const { pickSafe, resolveAction, writeAuditLog } = require('../utils/adminAudit');

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function normalizeDuration(value, field = 'durationMins') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 15 || n > 480) {
    throw new BadRequestError(`${field} debe ser un entero entre 15 y 480 minutos`);
  }
  return n;
}

function normalizeBuffer(value) {
  if (value === undefined) return 15;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 90) {
    throw new BadRequestError('bufferMins debe ser un entero entre 0 y 90 minutos');
  }
  return n;
}

function normalizeColor(value) {
  if (value === undefined || value === null || value === '') return '#8C6E50';
  if (typeof value !== 'string' || !HEX_COLOR_RE.test(value)) {
    throw new BadRequestError('colorHex debe tener formato hexadecimal, por ejemplo #8C6E50');
  }
  return value.toUpperCase();
}

async function resolveRoomConnections(tx, tenantId, roomIds) {
  if (roomIds === undefined) return undefined;
  if (!Array.isArray(roomIds)) throw new BadRequestError('roomIds debe ser una lista de cabinas');
  const uniqueIds = [...new Set(roomIds.map(String).filter(Boolean))];
  if (uniqueIds.length === 0) return { set: [] };
  const rooms = await tx.room.findMany({
    where: { tenantId, id: { in: uniqueIds }, active: true },
    select: { id: true },
  });
  if (rooms.length !== uniqueIds.length) {
    throw new BadRequestError('Una o más cabinas no pertenecen al tenant o están inactivas');
  }
  return { set: rooms.map((r) => ({ id: r.id })) };
}

async function listServices(actor, query) {
  const where = {};
  if (actor.role === 'superadmin') {
    if (query.tenantId) where.tenantId = query.tenantId;
  } else {
    where.tenantId = actor.tenantId;
  }
  return prisma.service.findMany({
    where,
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    include: { rooms: { select: { id: true, name: true, specialty: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } } },
  });
}

async function getService(actor, id) {
  const service = await prisma.service.findUnique({
    where: { id },
    include: { rooms: { select: { id: true, name: true, specialty: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!service) return null;
  assertTenantScope(actor, service.tenantId);
  return service;
}

async function createService(actor, data) {
  const tenantId = resolveTenantId(actor, data.tenantId);
  if (!tenantId) {
    throw new BadRequestError('tenantId es requerido');
  }
  if (!data.name || !data.category) {
    throw new BadRequestError('name y category son requeridos');
  }

  return prisma.$transaction(async (tx) => {
    const rooms = await resolveRoomConnections(tx, tenantId, data.roomIds);
    const service = await tx.service.create({
      data: {
        tenantId,
        name: String(data.name).trim(),
        category: String(data.category).trim(),
        durationMins: data.durationMins === undefined ? 60 : normalizeDuration(data.durationMins),
        bufferMins: normalizeBuffer(data.bufferMins),
        colorHex: normalizeColor(data.colorHex),
        priceUsd: data.priceUsd,
        offersHomeService: false,
        active: true,
        ...(rooms !== undefined ? { rooms } : {}),
      },
      include: { rooms: { select: { id: true, name: true, specialty: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } } },
    });
    await writeAuditLog(tx, {
      actor,
      entity: 'service',
      entityId: service.id,
      action: 'create',
      detail: pickSafe('service', service),
    });
    return service;
  });
}

async function updateService(actor, id, changes) {
  const target = await prisma.service.findUnique({ where: { id } });
  if (!target) return null;
  assertTenantScope(actor, target.tenantId);

  const data = {};
  if (changes.name !== undefined) data.name = changes.name;
  if (changes.category !== undefined) data.category = changes.category;
  if (changes.priceUsd !== undefined) data.priceUsd = changes.priceUsd;
  if (changes.durationMins !== undefined) data.durationMins = normalizeDuration(changes.durationMins);
  if (changes.bufferMins !== undefined) data.bufferMins = normalizeBuffer(changes.bufferMins);
  if (changes.colorHex !== undefined) data.colorHex = normalizeColor(changes.colorHex);
  if (changes.offersHomeService !== undefined) data.offersHomeService = false;
  if (changes.active !== undefined) data.active = !!changes.active;

  const hasRoomChanges = changes.roomIds !== undefined;
  if (Object.keys(data).length === 0 && !hasRoomChanges) return target;

  if (data.active === false && target.active) {
    const otherActiveSameCategory = await prisma.service.count({
      where: { tenantId: target.tenantId, category: target.category, active: true, id: { not: id } },
    });
    if (otherActiveSameCategory === 0) {
      const dependentRoom = await prisma.room.findFirst({
        where: { tenantId: target.tenantId, specialty: target.category, active: true },
      });
      if (dependentRoom) {
        throw new BadRequestError(
          `No se puede desactivar: el gabinete "${dependentRoom.name}" depende de la categoría "${target.category}" y quedaría sin ningún servicio activo que la respalde`
        );
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    const rooms = await resolveRoomConnections(tx, target.tenantId, changes.roomIds);
    const updated = await tx.service.update({
      where: { id },
      data: {
        ...data,
        ...(rooms !== undefined ? { rooms } : {}),
      },
      include: { rooms: { select: { id: true, name: true, specialty: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } } },
    });
    const action = resolveAction('service', data, target);
    await writeAuditLog(tx, {
      actor,
      entity: 'service',
      entityId: id,
      action,
      detail: pickSafe('service', data),
    });
    return updated;
  });
}

async function deleteService(actor, id) {
  return updateService(actor, id, { active: false });
}

module.exports = { listServices, getService, createService, updateService, deleteService };
