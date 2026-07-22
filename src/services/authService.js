const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { signToken } = require('../utils/jwt');

const SALT_ROUNDS = 10;

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

module.exports = { hashPassword, login };
