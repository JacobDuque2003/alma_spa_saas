const SUMMARY_WHITELIST = {
  // passwordChanged es un flag booleano — nunca el hash ni la clave. Se
  // agrega al detalle desde userService cuando un admin resetea la contraseña
  // de otra cuenta, así queda registro en AdminAuditLog de que hubo reseteo
  // (con action='update') sin filtrar material sensible.
  user: ['name', 'email', 'role', 'active', 'canAttendAppointments', 'isProtected', 'jobTitle', 'passwordChanged'],
  service: ['name', 'category', 'durationMins', 'bufferMins', 'colorHex', 'priceUsd', 'offersHomeService', 'active', 'description'],
  room: ['name', 'specialty', 'sortOrder', 'capacity', 'colorHex', 'opensAt', 'closesAt', 'active', 'status'],
  category: ['name', 'active'],
  auth: [],
};

function pickSafe(entity, obj) {
  const allowed = SUMMARY_WHITELIST[entity];
  if (!allowed || !obj) return undefined;
  const out = {};
  for (const key of allowed) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function resolveAction(entity, changes, previousState) {
  if (!previousState) return 'create';
  if (changes.active === true && !previousState.active) return 'activate';
  if (changes.active === false && previousState.active) return 'deactivate';
  return 'update';
}

function writeAuditLog(tx, { actor, entity, entityId, action, detail, tenantId = actor.tenantId }) {
  if (!tenantId) {
    throw new Error('No se puede auditar una acción sin tenantId');
  }
  return tx.adminAuditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorEmail: actor.email,
      entity,
      entityId,
      action,
      detail: detail || undefined,
    },
  });
}

module.exports = { pickSafe, resolveAction, writeAuditLog, SUMMARY_WHITELIST };
