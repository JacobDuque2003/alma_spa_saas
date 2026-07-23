const jwt = require('jsonwebtoken');

const JWT_MIN_BYTES = 32;

function signToken({ id, tenantId, role, email }) {
  return jwt.sign(
    { sub: id, tenantId: tenantId ?? null, role, email: email ?? null },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}

function assertJwtSecretOrExit() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[FATAL] JWT_SECRET requerida');
    process.exit(1);
  }
  const byteLength = Buffer.byteLength(secret, 'utf8');
  if (byteLength < JWT_MIN_BYTES) {
    console.error(
      `[FATAL] JWT_SECRET debe tener al menos ${JWT_MIN_BYTES} bytes (tiene ${byteLength}). ` +
      'Genera una con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"'
    );
    process.exit(1);
  }
}

module.exports = { signToken, verifyToken, assertJwtSecretOrExit };
