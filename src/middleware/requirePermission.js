const prisma = require('../utils/prisma');

const BYPASS_ROLES = ['superadmin', 'dueno'];

function requirePermission(moduleName) {
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

    if (!rolePermission || !rolePermission[moduleName]) {
      return res.status(403).json({ error: `Sin permiso para el módulo: ${moduleName}` });
    }

    next();
  };
}

module.exports = requirePermission;
