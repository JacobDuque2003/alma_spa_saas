class ForbiddenTenantError extends Error {
  constructor() {
    super('No tiene acceso a este recurso');
    this.status = 403;
  }
}

function assertTenantScope(actor, targetTenantId) {
  // superadmin (sin tenant) puede operar sobre cualquier tenant.
  if (actor.role === 'superadmin') return;
  if (actor.tenantId !== targetTenantId) {
    throw new ForbiddenTenantError();
  }
}

/**
 * tenantId SIEMPRE se deriva del JWT del actor — cualquier tenantId que el
 * cliente mande en el body/query se ignora por completo para dueno/personal.
 * Solo superadmin, que no tiene tenant propio, puede/debe asignar uno explícito.
 */
function resolveTenantId(actor, bodyTenantId) {
  return actor.role === 'superadmin' ? bodyTenantId : actor.tenantId;
}

module.exports = { assertTenantScope, resolveTenantId, ForbiddenTenantError };
