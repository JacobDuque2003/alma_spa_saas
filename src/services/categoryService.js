const prisma = require('../utils/prisma');
const { assertTenantScope, resolveTenantId } = require('../utils/tenantScope');
const { BadRequestError, AppError } = require('../utils/errors');
const { pickSafe, writeAuditLog } = require('../utils/adminAudit');

async function listCategories(actor, query) {
  const where = { active: true };
  if (actor.role === 'superadmin') {
    if (query.tenantId) where.tenantId = query.tenantId;
  } else {
    where.tenantId = actor.tenantId;
  }
  return prisma.serviceCategory.findMany({ where });
}

async function createCategory(actor, data) {
  const tenantId = resolveTenantId(actor, data.tenantId);
  if (!tenantId) {
    throw new BadRequestError('tenantId es requerido');
  }
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) {
    throw new BadRequestError('name es requerido');
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const cat = await tx.serviceCategory.create({
        data: { tenantId, name, active: true },
      });
      await writeAuditLog(tx, {
        actor,
        entity: 'category',
        entityId: cat.id,
        action: 'create',
        detail: pickSafe('category', { name }),
      });
      return cat;
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new AppError('Ya existe una categoría con ese nombre en este tenant', 409);
    }
    throw err;
  }
}

async function updateCategory(actor, id, changes) {
  const target = await prisma.serviceCategory.findUnique({ where: { id } });
  if (!target) return null;
  assertTenantScope(actor, target.tenantId);

  const data = {};
  if (changes.name !== undefined) {
    const name = typeof changes.name === 'string' ? changes.name.trim() : '';
    if (!name) {
      throw new BadRequestError('name es requerido');
    }
    data.name = name;
  }

  if (Object.keys(data).length === 0) return target;

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.serviceCategory.update({ where: { id }, data });
      await writeAuditLog(tx, {
        actor,
        entity: 'category',
        entityId: id,
        action: 'update',
        detail: pickSafe('category', data),
      });
      return updated;
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new AppError('Ya existe una categoría con ese nombre en este tenant', 409);
    }
    throw err;
  }
}

async function deleteCategory(actor, id) {
  const target = await prisma.serviceCategory.findUnique({ where: { id } });
  if (!target) return null;
  assertTenantScope(actor, target.tenantId);

  const dependentRoom = await prisma.room.findFirst({
    where: { tenantId: target.tenantId, specialty: target.name, active: true },
  });
  if (dependentRoom) {
    throw new AppError(
      `No se puede eliminar esta categoría porque hay gabinetes activos que la usan (ej: "${dependentRoom.name}")`,
      409
    );
  }

  const dependentService = await prisma.service.findFirst({
    where: { tenantId: target.tenantId, category: target.name, active: true },
  });
  if (dependentService) {
    throw new AppError(
      `No se puede eliminar esta categoría porque hay servicios activos que la usan (ej: "${dependentService.name}")`,
      409
    );
  }

  return prisma.$transaction(async (tx) => {
    const deactivated = await tx.serviceCategory.update({ where: { id }, data: { active: false } });
    await writeAuditLog(tx, {
      actor,
      entity: 'category',
      entityId: id,
      action: 'deactivate',
      detail: pickSafe('category', target),
    });
    return deactivated;
  });
}

module.exports = { listCategories, createCategory, updateCategory, deleteCategory };
