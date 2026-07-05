const prisma = require('../utils/prisma');

/**
 * Rechazo temprano en la ruta. El guard real e inevitable vive en
 * userService (se aplica aunque una ruta futura olvide este middleware).
 */
async function protectSuperadmin(req, res, next) {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (target?.isProtected) {
    return res.status(403).json({ error: 'Esta cuenta está protegida y no puede editarse ni eliminarse' });
  }
  next();
}

module.exports = protectSuperadmin;
