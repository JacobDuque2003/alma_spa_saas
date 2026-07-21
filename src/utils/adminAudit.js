const SUMMARY_WHITELIST = {
  user: ['name', 'email', 'role', 'active', 'canAttendAppointments', 'isProtected'],
  service: ['name', 'category', 'priceUsd', 'offersHomeService', 'active'],
  room: ['name', 'specialty', 'opensAt', 'closesAt', 'active', 'status'],
  category: ['name', 'active'],
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

function writeAuditLog(tx, { actor, entity, entityId, action, detail }) {
  return tx.adminAuditLog.create({
    data: {
      tenantId: actor.tenantId,
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
