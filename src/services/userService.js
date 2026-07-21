const prisma = require('../utils/prisma');
const { hashPassword } = require('./authService');
const { assertTenantScope, resolveTenantId, ForbiddenTenantError } = require('../utils/tenantScope');
const { AppError, BadRequestError } = require('../utils/errors');
const { pickSafe, resolveAction, writeAuditLog } = require('../utils/adminAudit');

class ProtectedAccountError extends AppError {
  constructor() {
    super('Esta cuenta está protegida y no puede editarse ni eliminarse', 403);
  }
}

function omitPasswordHash(user) {
  if (!user) return user;
  const { passwordHash, ...rest } = user;
  return rest;
}


const USER_SAFE_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  name: true,
  role: true,
  isProtected: true,
  active: true,
  canAttendAppointments: true,
  createdAt: true,
  updatedAt: true,
  rolePermission: true,
};

async function listUsers(actor, query = {}) {
  const where = {};
  if (actor.role === 'superadmin') {
    if (query.tenantId) where.tenantId = query.tenantId;
  } else {
    where.tenantId = actor.tenantId;
  }

  const users = await prisma.user.findMany({
    where,
    select: USER_SAFE_SELECT,
    orderBy: [{ isProtected: 'desc' }, { role: 'asc' }, { name: 'asc' }],
  });
  return users.map(omitPasswordHash);
}

const ALLOWED_ROLES_FOR_CREATION = ['personal', 'dueno'];
const MIN_PASSWORD_LENGTH = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createUser(actor, data) {
  const { email, password, name, role, permissions, canAttendAppointments } = data;

  if (!email || !EMAIL_REGEX.test(email)) {
    throw new BadRequestError('Email inválido');
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
  }
  if (!name || !name.trim()) {
    throw new BadRequestError('El nombre es requerido');
  }

  if (!ALLOWED_ROLES_FOR_CREATION.includes(role)) {
    throw new BadRequestError('Rol no permitido. Solo se pueden crear cuentas: personal, dueno');
  }

  const tenantId = resolveTenantId(actor, data.tenantId);
  if (!tenantId) {
    throw new BadRequestError('tenantId es requerido para roles dueno/personal');
  }

  const pw = await hashPassword(password);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash: pw,
        name,
        role,
        tenantId,
        isProtected: false,
        canAttendAppointments: !!canAttendAppointments,
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
    await writeAuditLog(tx, {
      actor,
      entity: 'user',
      entityId: user.id,
      action: 'create',
      detail: pickSafe('user', { name, email, role, canAttendAppointments: !!canAttendAppointments }),
    });
    return user;
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

  if (changes.active === false && actor.id === targetUserId) {
    throw new BadRequestError('No puedes desactivar tu propia cuenta');
  }

  const data = {};
  if (changes.name !== undefined) data.name = changes.name;
  if (changes.active !== undefined) data.active = changes.active;
  if (changes.password) data.passwordHash = await hashPassword(changes.password);

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: targetUserId }, data });
    const action = resolveAction('user', data, target);
    const safeChanges = { ...data };
    delete safeChanges.passwordHash;
    if (changes.password) safeChanges.passwordChanged = true;
    await writeAuditLog(tx, {
      actor,
      entity: 'user',
      entityId: targetUserId,
      action,
      detail: pickSafe('user', safeChanges),
    });
    return user;
  });
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

  return prisma.$transaction(async (tx) => {
    const deleted = await tx.user.delete({ where: { id: targetUserId } });
    await writeAuditLog(tx, {
      actor,
      entity: 'user',
      entityId: targetUserId,
      action: 'purge',
      detail: pickSafe('user', target),
    });
    return deleted;
  });
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

  return prisma.$transaction(async (tx) => {
    const result = await tx.rolePermission.upsert({
      where: { userId: targetUserId },
      update: permissions,
      create: { userId: targetUserId, ...permissions },
    });
    await writeAuditLog(tx, {
      actor,
      entity: 'user',
      entityId: targetUserId,
      action: 'permissionsChanged',
      detail: permissions,
    });
    return result;
  });
}

module.exports = {
  ALLOWED_ROLES_FOR_CREATION,
  MIN_PASSWORD_LENGTH,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  updatePermissions,
  ProtectedAccountError,
  ForbiddenTenantError,
};
