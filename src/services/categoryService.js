const prisma = require('../utils/prisma');
const { assertTenantScope, resolveTenantId } = require('../utils/tenantScope');
const { BadRequestError, AppError } = require('../utils/errors');

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
    return await prisma.serviceCategory.create({
      data: {
        tenantId,
        name,
        active: true,
      },
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
    return await prisma.serviceCategory.update({ where: { id }, data });
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

  // Cascade guard: no se puede desactivar una categoría si hay gabinetes activos
  // cuya specialty coincide con el nombre de esta categoría.
  const dependentRoom = await prisma.room.findFirst({
    where: { tenantId: target.tenantId, specialty: target.name, active: true },
  });
  if (dependentRoom) {
    throw new AppError(
      `No se puede eliminar esta categoría porque hay gabinetes activos que la usan (ej: "${dependentRoom.name}")`,
      409
    );
  }

  // Cascade guard: no se puede desactivar si hay servicios activos asociados
  // (el admin primero debe reasignar o desactivar esos servicios).
  const dependentService = await prisma.service.findFirst({
    where: { tenantId: target.tenantId, category: target.name, active: true },
  });
  if (dependentService) {
    throw new AppError(
      `No se puede eliminar esta categoría porque hay servicios activos que la usan (ej: "${dependentService.name}")`,
      409
    );
  }

  return prisma.serviceCategory.update({ where: { id }, data: { active: false } });
}

module.exports = { listCategories, createCategory, updateCategory, deleteCategory };
