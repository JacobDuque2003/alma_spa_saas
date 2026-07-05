const jwt = require('jsonwebtoken');

function signToken({ id, tenantId, role }) {
  return jwt.sign(
    { sub: id, tenantId: tenantId ?? null, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
