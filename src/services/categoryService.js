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

  return prisma.serviceCategory.update({ where: { id }, data: { active: false } });
}

module.exports = { listCategories, createCategory, updateCategory, deleteCategory };
