const { verifyToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');
const accessSchedule = require('./accessSchedule');

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  req.user = { id: payload.sub, tenantId: payload.tenantId, role: payload.role, email: payload.email || null };

  if (!req.user.email) {
    try {
      const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true } });
      if (u) req.user.email = u.email;
    } catch { /* email lookup best-effort */ }
  }

  // Chequeo de accessSchedule al final del ciclo de auth: si el usuario está
  // fuera de su ventana, el middleware devuelve 403 con { reason:'outOfSchedule',
  // nextWindowOpensAt } y no llama next(). Cada ruta protegida hereda esto sin
  // cambios propios (por diseño: seguridad centralizada, no per-route).
  return accessSchedule(req, res, next);
}

module.exports = authenticate;
