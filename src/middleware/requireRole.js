/**
 * Gestión de personal no tiene booleano en RolePermission (ver brief §Personal):
 * solo dueno/superadmin administran cuentas de staff, nunca delegable a "personal".
 */
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tiene permiso para esta acción' });
    }
    next();
  };
}

module.exports = requireRole;
