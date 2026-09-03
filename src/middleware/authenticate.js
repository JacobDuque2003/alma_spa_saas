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

  let currentUser;
  try {
    currentUser = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        tenantId: true,
        role: true,
        email: true,
        active: true,
        sessionVersion: true,
      },
    });
  } catch (err) {
    return next(err);
  }

  const tokenSessionVersion = Number(payload.sessionVersion ?? 0);
  const currentSessionVersion = Number(currentUser?.sessionVersion ?? 0);
  const identityChanged = currentUser
    && (currentUser.role !== payload.role || currentUser.tenantId !== payload.tenantId);

  if (!currentUser || currentUser.active === false || identityChanged || tokenSessionVersion !== currentSessionVersion) {
    return res.status(401).json({ error: 'Sesión inválida o cuenta actualizada. Inicie sesión nuevamente.' });
  }

  // La identidad y el rol efectivos siempre salen de la base de datos. El JWT
  // solo prueba que la sesión fue emitida para la misma versión de la cuenta.
  req.user = {
    id: currentUser.id,
    tenantId: currentUser.tenantId,
    role: currentUser.role,
    email: currentUser.email || null,
  };

  // Chequeo de accessSchedule al final del ciclo de auth: si el usuario está
  // fuera de su ventana, el middleware devuelve 403 con { reason:'outOfSchedule',
  // nextWindowOpensAt } y no llama next(). Cada ruta protegida hereda esto sin
  // cambios propios (por diseño: seguridad centralizada, no per-route).
  return accessSchedule(req, res, next);
}

module.exports = authenticate;
