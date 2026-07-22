const { verifyToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, tenantId: payload.tenantId, role: payload.role, email: payload.email || null };

    if (!req.user.email) {
      Promise.resolve()
        .then(() => prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true } }))
        .then((u) => { if (u) req.user.email = u.email; })
        .catch(() => {})
        .finally(() => next());
      return;
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = authenticate;
