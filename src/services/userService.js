const prisma = require('../utils/prisma');
const { hashPassword } = require('./authService');
const { assertTenantScope, resolveTenantId, ForbiddenTenantError } = require('../utils/tenantScope');
const { AppError, BadRequestError } = require('../utils/errors');
const { pickSafe, resolveAction, writeAuditLog } = require('../utils/adminAudit');
const { validateSchedule } = require('../utils/accessSchedule');

class ProtectedAccountError extends AppError {
  constructor() {
    super('Esta cuenta está protegida y no puede editarse ni eliminarse', 403);
  }
}

function omitPasswordHash(user) {
  if (!user) return user;
  const { passwordHash, sessionVersion, ...rest } = user;
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
  accessSchedule: true,
  createdAt: true,
  updatedAt: true,
  rolePermission: true,
};

const PERMISSION_KEYS = [
  'agenda',
  'gabinetes',
  'clientes',
  'crm',
  'reportes',
  'configuracion',
  'configuracionServicios',
  'configuracionHorario',
  'clientesEditar',
  'clientesAnamnesis',
  'clientesHistorial',
  'clientesEstado',
  'clientesEliminar',
  'clientesExportar',
  'crmEtiquetasGestionar',
  'crmRespuestasRapidasGestionar',
  'crmNotasGestionar',
];

function normalizePermissions(input = {}) {
  return Object.fromEntries(PERMISSION_KEYS.map((key) => [key, !!input[key]]));
}

async function listUsers(actor, query = {}) {
  const where = { deletedAt: null };
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
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createUser(actor, data) {
  const { email, password, name, role, permissions, canAttendAppointments, accessSchedule } = data;

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

  // Validar accessSchedule si viene. null y ausente → fail-open (24/7 con
  // badge en /personal). Es el prefill de UI el que lo llena con
  // businessHours por default, no un fallback silencioso del backend.
  if (accessSchedule !== undefined) {
    const err = validateSchedule(accessSchedule);
    if (err) throw new BadRequestError(err);
  }

  const tenantId = resolveTenantId(actor, data.tenantId);
  if (!tenantId) {
    throw new BadRequestError('tenantId es requerido para roles dueno/personal');
  }

  const pw = await hashPassword(password);

  const created = await prisma.$transaction(async (tx) => {
    if (role === 'dueno') {
      const activeOwners = await tx.user.count({
        where: { tenantId, role: 'dueno', active: true, deletedAt: null },
      });
      if (activeOwners > 0) {
        throw new BadRequestError('Este negocio ya tiene una cuenta Dueña activa');
      }
    }
    const user = await tx.user.create({
      data: {
        email,
        passwordHash: pw,
        name,
        role,
        tenantId,
        isProtected: false,
        canAttendAppointments: !!canAttendAppointments,
        accessSchedule: accessSchedule !== undefined ? accessSchedule : null,
        ...(role === 'personal'
          ? {
              rolePermission: {
                create: {
                  ...normalizePermissions(permissions),
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
      tenantId: user.tenantId,
    });
    return user;
  }, { isolationLevel: 'Serializable' });
  return omitPasswordHash(created);
}

async function updateUser(actor, targetUserId, changes) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target || target.deletedAt) {
    return null;
  }
  if (target.isProtected) {
    throw new ProtectedAccountError();
  }
  assertTenantScope(actor, target.tenantId);

  if (changes.active === false && actor.id === targetUserId) {
    throw new BadRequestError('No puedes desactivar tu propia cuenta');
  }

  if (changes.role !== undefined) {
    if (!ALLOWED_ROLES_FOR_CREATION.includes(changes.role)) {
      throw new BadRequestError('Rol no permitido. Solo se puede usar Terapeuta o Dueña');
    }
    if (actor.id === targetUserId && changes.role !== target.role) {
      throw new BadRequestError('No puedes cambiar tu propio rol');
    }
  }

  const data = {};
  if (changes.name !== undefined) data.name = changes.name;
  if (changes.active !== undefined) data.active = changes.active;
  if (changes.role !== undefined) data.role = changes.role;
  if (changes.canAttendAppointments !== undefined) data.canAttendAppointments = !!changes.canAttendAppointments;
  if (changes.password) data.passwordHash = await hashPassword(changes.password);
  if (changes.accessSchedule !== undefined) {
    const err = validateSchedule(changes.accessSchedule);
    if (err) throw new BadRequestError(err);
    data.accessSchedule = changes.accessSchedule;
  }

  const invalidatesSession = (
    changes.role !== undefined
    || changes.active !== undefined
    || !!changes.password
    || changes.accessSchedule !== undefined
  );
  if (invalidatesSession) data.sessionVersion = { increment: 1 };

  const updated = await prisma.$transaction(async (tx) => {
    const nextRole = changes.role ?? target.role;
    const nextActive = changes.active ?? target.active;
    const becomesActiveOwner = nextRole === 'dueno'
      && nextActive !== false
      && (target.role !== 'dueno' || target.active === false);
    if (becomesActiveOwner) {
      const otherActiveOwners = await tx.user.count({
        where: {
          tenantId: target.tenantId,
          role: 'dueno',
          active: true,
          deletedAt: null,
          id: { not: targetUserId },
        },
      });
      if (otherActiveOwners > 0) {
        throw new BadRequestError('Este negocio ya tiene una cuenta Dueña activa');
      }
    }
    const removesLastOwner = target.role === 'dueno'
      && (changes.role === 'personal' || (target.active !== false && changes.active === false));
    if (removesLastOwner) {
      const otherActiveOwners = await tx.user.count({
        where: {
          tenantId: target.tenantId,
          role: 'dueno',
          active: true,
          id: { not: targetUserId },
        },
      });
      if (otherActiveOwners === 0) {
        throw new BadRequestError('Debe existir al menos una cuenta Dueña activa');
      }
    }

    const user = await tx.user.update({
      where: { id: targetUserId },
      data,
      include: { rolePermission: true },
    });
    if (changes.role === 'personal' && target.role !== 'personal') {
      user.rolePermission = await tx.rolePermission.upsert({
        where: { userId: targetUserId },
        update: {},
        create: { userId: targetUserId, ...normalizePermissions() },
      });
    }
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
      tenantId: target.tenantId,
    });
    return user;
  }, { isolationLevel: 'Serializable' });
  return omitPasswordHash(updated);
}

async function deleteUser(actor, targetUserId) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target || target.deletedAt) {
    return null;
  }
  if (target.isProtected) {
    throw new ProtectedAccountError();
  }
  if (actor.id === targetUserId) {
    throw new BadRequestError('No puedes eliminar tu propia cuenta');
  }
  assertTenantScope(actor, target.tenantId);

  return prisma.$transaction(async (tx) => {
    if (target.role === 'dueno') {
      const otherActiveOwners = await tx.user.count({
        where: {
          tenantId: target.tenantId,
          role: 'dueno',
          active: true,
          id: { not: targetUserId },
        },
      });
      if (otherActiveOwners === 0) {
        throw new BadRequestError('No se puede eliminar la única cuenta Dueña activa');
      }
    }
    // Las citas, tratamientos, notas y movimientos conservan la referencia a
    // quien actuó. Por eso la eliminación visible archiva y revoca la cuenta,
    // en lugar de romper o borrar el historial operativo del spa.
    const deleted = await tx.user.update({
      where: { id: targetUserId },
      data: {
        active: false,
        deletedAt: new Date(),
        sessionVersion: { increment: 1 },
        email: `deleted-${targetUserId}@accounts.invalid`,
      },
    });
    await writeAuditLog(tx, {
      actor,
      entity: 'user',
      entityId: targetUserId,
      action: 'purge',
      detail: pickSafe('user', target),
      tenantId: target.tenantId,
    });
    return deleted;
  }, { isolationLevel: 'Serializable' });
}

async function updatePermissions(actor, targetUserId, permissions) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target || target.deletedAt) {
    return null;
  }
  if (target.isProtected) {
    throw new ProtectedAccountError();
  }
  if (target.role !== 'personal') {
    throw new BadRequestError('Solo las cuentas de personal tienen permisos por módulo');
  }
  assertTenantScope(actor, target.tenantId);

  const safePermissions = normalizePermissions(permissions);

  return prisma.$transaction(async (tx) => {
    const result = await tx.rolePermission.upsert({
      where: { userId: targetUserId },
      update: safePermissions,
      create: { userId: targetUserId, ...safePermissions },
    });
    await tx.user.update({
      where: { id: targetUserId },
      data: { sessionVersion: { increment: 1 } },
    });
    await writeAuditLog(tx, {
      actor,
      entity: 'user',
      entityId: targetUserId,
      action: 'permissionsChanged',
      detail: safePermissions,
      tenantId: target.tenantId,
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
  PERMISSION_KEYS,
  normalizePermissions,
};
