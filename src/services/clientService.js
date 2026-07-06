const prisma = require('../utils/prisma');

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

module.exports = { lookupClient, upsertClient };
