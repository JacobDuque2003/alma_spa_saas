const prisma = require('../utils/prisma');
const { checkAccess } = require('../utils/accessSchedule');
const { getTenantTimezone } = require('../utils/timezone');

// Post-authenticate middleware. Bloquea requests si el usuario está fuera de
// su ventana de acceso. Rechazos se auditan con throttling (1 por sesión+día).
//
// Bypass permanente:
//  - role: 'dueno' | 'superadmin'  → siempre permitido (hardcoded, no
//    configurable desde UI). Aplica alwaysAllowed=true al helper.
//
// Fail-open cuando accessSchedule está null (usuario recién creado sin
// configurar horario). Frontend lo señala con badge amarillo en /personal.

// Cache in-memory de eventos ya auditados. Clave: `${userId}|${YYYY-MM-DD}`.
// Se limpia perezosamente cuando pasa la fecha. Suficiente para un piloto
// de una sola instancia — si el proceso reinicia se re-arma, con costo bajo
// (a lo sumo 1 entrada duplicada por reinicio × cuenta afectada).
const auditedToday = new Map();

function throttleKey(userId, dateStr) {
  return `${userId}|${dateStr}`;
}

function todayKeyInTz(tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function maybeAuditDeny(user, tenantId, tz) {
  const dateStr = todayKeyInTz(tz);
  const key = throttleKey(user.id, dateStr);
  if (auditedToday.has(key)) return; // ya auditado hoy
  auditedToday.set(key, true);
  // Limpia entradas viejas si el cache crece — barato para 3 cuentas.
  if (auditedToday.size > 500) {
    for (const [k] of auditedToday) {
      if (!k.endsWith(dateStr)) auditedToday.delete(k);
    }
  }
  try {
    await prisma.adminAuditLog.create({
      data: {
        tenantId,
        actorId: user.id,
        actorEmail: user.email || 'unknown',
        entity: 'user',
        entityId: user.id,
        action: 'accessDeniedSchedule',
        detail: { at: new Date().toISOString(), tz },
      },
    });
  } catch { /* audit best-effort; no queremos que un fallo aquí bloquee auth */ }
}

async function accessSchedule(req, res, next) {
  try {
    if (!req.user) return next();

    const roleAlwaysAllowed = req.user.role === 'superadmin' || req.user.role === 'dueno';

    // Cargar accessSchedule + timezone del tenant en un solo ida y vuelta
    // (solo si el rol no bypassa; ahorra queries en el caso común de dueño).
    if (roleAlwaysAllowed) return next();

    const [userRow, tenantRow] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.user.id }, select: { accessSchedule: true, active: true } }),
      req.user.tenantId
        ? prisma.tenant.findUnique({ where: { id: req.user.tenantId }, select: { config: true } })
        : Promise.resolve(null),
    ]);

    if (!userRow || !userRow.active) {
      // Cuenta borrada o inactiva — el resto de la app ya rechazará; aquí solo pasamos.
      return next();
    }

    const tz = getTenantTimezone(tenantRow?.config);
    const result = checkAccess(userRow.accessSchedule, new Date(), tz, { roleAlwaysAllowed });

    if (result.allowed) return next();

    const readOnlyMethod = ['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase());
    if (readOnlyMethod) {
      res.set('X-Alma-Out-Of-Schedule', '1');
      res.set('X-Alma-Out-Of-Schedule-Next', result.nextWindowOpensAt ? result.nextWindowOpensAt.toISOString() : '');
      return next();
    }

    // Auditar con throttling
    await maybeAuditDeny(req.user, req.user.tenantId, tz);

    return res.status(403).json({
      error: 'Fuera del horario de acceso permitido',
      reason: 'outOfSchedule',
      nextWindowOpensAt: result.nextWindowOpensAt ? result.nextWindowOpensAt.toISOString() : null,
    });
  } catch (err) {
    // Fail-open ante errores inesperados (no dejar auth colgada por un bug aquí).
    // El error se sigue propagando para logging server-side.
    console.warn('[accessSchedule] error, fail-open:', err?.message);
    return next();
  }
}

module.exports = accessSchedule;
module.exports._auditedToday = auditedToday; // exports para tests
