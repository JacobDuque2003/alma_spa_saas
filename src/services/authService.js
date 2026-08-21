const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { signToken } = require('../utils/jwt');

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
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    return null;
  }

  const validPassword = await bcrypt.compare(plainPassword, user.passwordHash);
  if (!validPassword) {
    return null;
  }

  // El login nunca se restringe por accessSchedule: autenticación (probar
  // identidad) y autorización por horario son cosas distintas. La cuenta
  // siempre puede entrar; el middleware accessSchedule (post-login) es quien
  // decide, en cada request, si esa sesión puede solo leer o también escribir.
  const token = signToken({ id: user.id, tenantId: user.tenantId, role: user.role, email: user.email });

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
