const prisma = require('../utils/prisma');
const { assertTenantScope, resolveTenantId } = require('../utils/tenantScope');
const { BadRequestError } = require('../utils/errors');

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
  return prisma.room.findMany({ where });
}

async function getRoom(actor, id) {
  const room = await prisma.room.findUnique({ where: { id } });
  if (!room) return null;
  assertTenantScope(actor, room.tenantId);
  return room;
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

  return prisma.room.create({
    data: {
      tenantId,
      name: data.name,
      specialty: data.specialty,
      opensAt: data.opensAt || '09:00',
      closesAt: data.closesAt || '19:00',
      status: 'libre',
      active: true,
    },
  });
}

async function updateRoom(actor, id, changes) {
  const target = await prisma.room.findUnique({ where: { id } });
  if (!target) return null;
  assertTenantScope(actor, target.tenantId);

  const data = {};
  if (changes.name !== undefined) data.name = changes.name;
  if (changes.specialty !== undefined) {
    await assertSpecialtyMatchesActiveCategory(target.tenantId, changes.specialty);
    data.specialty = changes.specialty;
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
  return prisma.room.update({ where: { id }, data });
}

async function deleteRoom(actor, id) {
  const target = await prisma.room.findUnique({ where: { id } });
  if (!target) return null;
  assertTenantScope(actor, target.tenantId);

  return prisma.room.update({ where: { id }, data: { active: false } });
}

module.exports = { listRooms, getRoom, createRoom, updateRoom, deleteRoom };
