const prisma = require('../utils/prisma');

const BYPASS_ROLES = ['superadmin', 'dueno'];

function requireAnyPermission(...moduleNames) {
  return async function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (BYPASS_ROLES.includes(req.user.role)) {
      return next();
    }

    const rolePermission = await prisma.rolePermission.findUnique({
      where: { userId: req.user.id },
    });

    const hasAny = rolePermission && moduleNames.some((m) => rolePermission[m]);
    if (!hasAny) {
      return res.status(403).json({ error: `Sin permiso para: ${moduleNames.join(' o ')}` });
    }

    next();
  };
}

module.exports = requireAnyPermission;
