const prisma = require('../utils/prisma');
const { assertTenantScope } = require('../utils/tenantScope');

/**
 * Carga el Client (siempre existe, a diferencia de ClientIntake) para derivar
 * el tenant y validar acceso ANTES de cualquier operación sobre sub-recursos
 * del cliente (anamnesis, tratamientos, planes, saldo). Devuelve null si no
 * existe (la ruta responde 404); lanza ForbiddenTenantError (403) si el
 * cliente es de otro tenant. Helper compartido por los servicios de Fase 4.
 */
async function loadClientForActor(actor, clientId) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return null;
  assertTenantScope(actor, client.tenantId);
  return client;
}

async function lookupClient(tenantId, whatsapp) {
  const client = await prisma.client.findUnique({
    where: { tenantId_whatsapp: { tenantId, whatsapp } },
    include: { intake: true },
  });

  if (!client) {
    return { exists: false, requiresIntake: true };
  }

  const requiresIntake = !client.intake || !client.intake.consentSigned;
  return { exists: true, clientId: client.id, requiresIntake };
}

/**
 * Upsert dentro de una transacción (el caller decide el tx) — el cliente
 * se crea o actualiza como parte de la misma operación atómica que crea
 * su ClientIntake y sus Appointment.
 */
async function upsertClient(tx, tenantId, { fullName, whatsapp, email }) {
  return tx.client.upsert({
    where: { tenantId_whatsapp: { tenantId, whatsapp } },
    update: { fullName, email },
    create: { tenantId, fullName, whatsapp, email },
  });
}

module.exports = { lookupClient, upsertClient, loadClientForActor };
