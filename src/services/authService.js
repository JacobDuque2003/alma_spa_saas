const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { signToken } = require('../utils/jwt');
const { checkAccess } = require('../utils/accessSchedule');
const { getTenantTimezone } = require('../utils/timezone');

const SALT_ROUNDS = 10;

class OutOfScheduleError extends Error {
  constructor(nextWindowOpensAt) {
    super('Fuera del horario de acceso permitido');
    this.name = 'OutOfScheduleError';
    this.nextWindowOpensAt = nextWindowOpensAt;
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

  // Gate de horario en login. Rol dueño/superadmin bypassa siempre.
  // Aunque el JWT se emitiera igual y el middleware post-authenticate bloqueara
  // cada request nueva, bloquear al momento del login (a) evita crear una
  // sesión "muerta" que confunde al usuario, (b) permite mensaje UX específico
  // ("fuera de horario" vs "credenciales inválidas") — el usuario ya proveyó
  // credenciales válidas, no hay fuga de información.
  const roleAlwaysAllowed = user.role === 'superadmin' || user.role === 'dueno';
  if (!roleAlwaysAllowed) {
    let tenantTz = 'America/Guayaquil';
    if (user.tenantId) {
      const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { config: true } });
      tenantTz = getTenantTimezone(tenant?.config);
    }
    const check = checkAccess(user.accessSchedule, new Date(), tenantTz, { roleAlwaysAllowed: false });
    if (!check.allowed) {
      throw new OutOfScheduleError(check.nextWindowOpensAt);
    }
  }

  const token = signToken({ id: user.id, tenantId: user.tenantId, role: user.role, email: user.email });
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

module.exports = { hashPassword, login, OutOfScheduleError };
