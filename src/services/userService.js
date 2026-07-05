const prisma = require('../utils/prisma');
const { hashPassword } = require('./authService');

class ProtectedAccountError extends Error {
  constructor() {
    super('Esta cuenta está protegida y no puede editarse ni eliminarse');
    this.status = 403;
  }
}

class ForbiddenTenantError extends Error {
  constructor() {
    super('No tiene acceso a este recurso');
    this.status = 403;
  }
}

function assertTenantScope(actor, targetTenantId) {
  // superadmin (sin tenant) puede operar sobre cualquier tenant.
  if (actor.role === 'superadmin') return;
  if (actor.tenantId !== targetTenantId) {
    throw new ForbiddenTenantError();
  }
}

async function createUser(actor, data) {
  const { email, password, name, role, tenantId, permissions } = data;

  if (role === 'superadmin') {
    throw new Error('No se pueden crear cuentas superadmin vía API');
  }
  if (!tenantId) {
    throw new Error('tenantId es requerido para roles dueno/personal');
  }
  assertTenantScope(actor, tenantId);

  const passwordHash = await hashPassword(password);

  return prisma.user.create({
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

  return prisma.user.update({ where: { id: targetUserId }, data });
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
    throw new Error('Solo las cuentas de personal tienen permisos por módulo');
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
