const prisma = require('../utils/prisma');
const { hashPassword } = require('./authService');
const { assertTenantScope, resolveTenantId, ForbiddenTenantError } = require('../utils/tenantScope');
const { BadRequestError } = require('../utils/errors');

class ProtectedAccountError extends Error {
  constructor() {
    super('Esta cuenta está protegida y no puede editarse ni eliminarse');
    this.status = 403;
  }
}

function omitPasswordHash(user) {
  if (!user) return user;
  const { passwordHash, ...rest } = user;
  return rest;
}

async function createUser(actor, data) {
  const { email, password, name, role, permissions } = data;

  if (role === 'superadmin') {
    throw new BadRequestError('No se pueden crear cuentas superadmin vía API');
  }

  const tenantId = resolveTenantId(actor, data.tenantId);
  if (!tenantId) {
    throw new BadRequestError('tenantId es requerido para roles dueno/personal');
  }

  const passwordHash = await hashPassword(password);

  const created = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role,
      tenantId,
      isProtected: false,
      ...(role === 'personal'
        ? {
            rolePermission: {
              create: {
                agenda: !!permissions?.agenda,
                gabinetes: !!permissions?.gabinetes,
                clientes: !!permissions?.clientes,
                crm: !!permissions?.crm,
                reportes: !!permissions?.reportes,
                configuracion: !!permissions?.configuracion,
              },
            },
          }
        : {}),
    },
    include: { rolePermission: true },
  });
  return omitPasswordHash(created);
}

async function updateUser(actor, targetUserId, changes) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    return null;
  }
  if (target.isProtected) {
    throw new ProtectedAccountError();
  }
  assertTenantScope(actor, target.tenantId);

  const data = {};
  if (changes.name !== undefined) data.name = changes.name;
  if (changes.active !== undefined) data.active = changes.active;
  if (changes.password) data.passwordHash = await hashPassword(changes.password);

  const updated = await prisma.user.update({ where: { id: targetUserId }, data });
  return omitPasswordHash(updated);
}

async function deleteUser(actor, targetUserId) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    return null;
  }
  if (target.isProtected) {
    throw new ProtectedAccountError();
  }
  assertTenantScope(actor, target.tenantId);

  return prisma.user.delete({ where: { id: targetUserId } });
}

async function updatePermissions(actor, targetUserId, permissions) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    return null;
  }
  if (target.isProtected) {
    throw new ProtectedAccountError();
  }
  if (target.role !== 'personal') {
    throw new BadRequestError('Solo las cuentas de personal tienen permisos por módulo');
  }
  assertTenantScope(actor, target.tenantId);

  return prisma.rolePermission.upsert({
    where: { userId: targetUserId },
    update: permissions,
    create: { userId: targetUserId, ...permissions },
  });
}

module.exports = {
  createUser,
  updateUser,
  deleteUser,
  updatePermissions,
  ProtectedAccountError,
  ForbiddenTenantError,
};
