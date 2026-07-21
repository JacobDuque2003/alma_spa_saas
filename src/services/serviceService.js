const prisma = require('../utils/prisma');
const { assertTenantScope, resolveTenantId } = require('../utils/tenantScope');
const { BadRequestError } = require('../utils/errors');
const { pickSafe, resolveAction, writeAuditLog } = require('../utils/adminAudit');

const FIXED_DURATION_MINS = 60;

async function listServices(actor, query) {
  const where = {};
  if (actor.role === 'superadmin') {
    if (query.tenantId) where.tenantId = query.tenantId;
  } else {
    where.tenantId = actor.tenantId;
  }
  return prisma.service.findMany({ where });
}

async function getService(actor, id) {
  const service = await prisma.service.findUnique({ where: { id } });
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
    const service = await tx.service.create({
      data: {
        tenantId,
        name: data.name,
        category: data.category,
        durationMins: FIXED_DURATION_MINS,
        priceUsd: data.priceUsd,
        offersHomeService: !!data.offersHomeService,
        active: true,
      },
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
  if (changes.offersHomeService !== undefined) data.offersHomeService = !!changes.offersHomeService;
  if (changes.active !== undefined) data.active = !!changes.active;

  if (Object.keys(data).length === 0) return target;

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
    const updated = await tx.service.update({ where: { id }, data });
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
