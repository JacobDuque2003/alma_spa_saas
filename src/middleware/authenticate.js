const { verifyToken } = require('../utils/jwt');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  try {
    const payload = verifyToken(token);
    // tenantId SIEMPRE viene del JWT — nunca de params/body/query del cliente.
    req.user = { id: payload.sub, tenantId: payload.tenantId, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = authenticate;
