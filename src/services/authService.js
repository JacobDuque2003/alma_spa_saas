const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { signToken } = require('../utils/jwt');
const { AppError } = require('../utils/errors');

const SALT_ROUNDS = 10;

// Best-effort: si el insert falla (DB caída un instante, columna cambiada
// sin regenerar cliente, etc.) NO impide el login/logout. El propósito del
// audit es visibilidad histórica; no debe ser un cuello de botella de la
// sesión. Mismo patrón que maybeAuditDeny en accessSchedule.
async function auditAuthEvent({ userId, email, tenantId, action }) {
  if (!tenantId) return; // superadmin: sin tenant, no hay dónde escribir
  try {
    await prisma.adminAuditLog.create({
      data: {
        tenantId,
        actorId: userId,
        actorEmail: email,
        entity: 'auth',
        entityId: userId,
        action,
        detail: undefined,
      },
    });
  } catch (err) {
    console.warn(`[audit-auth] fallo al registrar ${action} de ${email}:`, err?.message);
  }
}

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function login(email, plainPassword) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      tenant: {
        select: {
          active: true,
          billingStatus: true,
        },
      },
    },
  });
  if (!user || !user.active) {
    return null;
  }

  const validPassword = await bcrypt.compare(plainPassword, user.passwordHash);
  if (!validPassword) {
    return null;
  }

  if (user.role !== 'superadmin' && Object.prototype.hasOwnProperty.call(user, 'tenant')) {
    if (!user.tenant || user.tenant.active === false) {
      throw new AppError('La cuenta del negocio no está disponible.', 403);
    }
    if (user.tenant.billingStatus === 'suspended') {
      throw new AppError('El acceso está suspendido por estado de mensualidad. Contacte a soporte.', 402);
    }
  }

  // El login nunca se restringe por accessSchedule: autenticación (probar
  // identidad) y autorización por horario son cosas distintas. La cuenta
  // siempre puede entrar; el middleware accessSchedule (post-login) es quien
  // decide, en cada request, si esa sesión puede solo leer o también escribir.
  const token = signToken({
    id: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
    sessionVersion: user.sessionVersion ?? 0,
  });

  await auditAuthEvent({ userId: user.id, email: user.email, tenantId: user.tenantId, action: 'login' });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
    },
  };
}

module.exports = { hashPassword, login, auditAuthEvent };
