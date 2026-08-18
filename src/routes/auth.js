const express = require('express');
const bcrypt = require('bcryptjs');
const { login, hashPassword, OutOfScheduleError } = require('../services/authService');
const authenticate = require('../middleware/authenticate');
const prisma = require('../utils/prisma');

const MODULE_PERMISSIONS = [
  'agenda',
  'gabinetes',
  'clientes',
  'crm',
  'reportes',
  'configuracion',
  'clientesEditar',
  'clientesAnamnesis',
  'clientesHistorial',
  'clientesEstado',
  'clientesEliminar',
  'clientesPagos',
  'clientesExportar',
];

const rateBuckets = new Map();
const MAX_RATE_BUCKETS = 10_000;

function makeRoomForBucket(buckets, now) {
  if (buckets.size < MAX_RATE_BUCKETS) return;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  // La llave contiene datos controlados por visitantes (IP/correo). Si tras
  // purgar expirados aún hay demasiadas, descartamos la más antigua para que
  // un ataque de alta cardinalidad no consuma memoria del proceso.
  while (buckets.size >= MAX_RATE_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (!oldest) break;
    buckets.delete(oldest);
  }
}

function bucketRateLimit(keyFn, limit, windowMs, message) {
  return function rateLimiter(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    const bucket = rateBuckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      if (!bucket) makeRoomForBucket(rateBuckets, now);
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

const loginRateLimit = bucketRateLimit(
  (req) => `login:${req.ip}:${(req.body.email || '').toLowerCase()}`,
  5, 15 * 60_000, 'Demasiados intentos de login. Espere 15 minutos.'
);
const passwordChangeRateLimit = bucketRateLimit(
  (req) => `pw:${req.user.id}`,
  5, 15 * 60_000, 'Demasiados intentos. Espere 15 minutos.'
);

function effectivePermissions(user) {
  if (['superadmin', 'dueno'].includes(user.role)) {
    return Object.fromEntries(MODULE_PERMISSIONS.map((m) => [m, true]));
  }
  const rp = user.rolePermission || {};
  return Object.fromEntries(MODULE_PERMISSIONS.map((m) => [m, !!rp[m]]));
}


const router = express.Router();

router.post('/login', loginRateLimit, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email y password son requeridos' });
    }

    let result;
    try {
      result = await login(email, password);
    } catch (err) {
      if (err instanceof OutOfScheduleError) {
        // Credenciales OK pero fuera de ventana. Se responde 403 (no 401)
        // porque el password sí fue válido — la denegación es de autorización
        // horaria, no de identidad. El frontend lee `reason` para mostrar el
        // mensaje "fuera de horario" en vez de "credenciales inválidas".
        return res.status(403).json({
          error: err.message,
          reason: 'outOfSchedule',
          nextWindowOpensAt: err.nextWindowOpensAt ? err.nextWindowOpensAt.toISOString() : null,
        });
      }
      throw err;
    }
    if (!result) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        tenantId: true,
        rolePermission: true,
      },
    });
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      permissions: effectivePermissions(user),
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/me/password', authenticate, passwordChangeRateLimit, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'currentPassword y newPassword deben ser cadenas de texto' });
    }
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword y newPassword son requeridos' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    }
    if (newPassword.length > 128) {
      return res.status(400).json({ error: 'La contraseña no puede exceder 128 caracteres' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, passwordHash: true } });
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(403).json({ error: 'Contraseña actual incorrecta' });
    }

    const newHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

    console.info('[password-changed]', { userId: user.id, ip: req.ip, at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
