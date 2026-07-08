const prisma = require('../utils/prisma');
const { assertTenantScope } = require('../utils/tenantScope');
const { BadRequestError } = require('../utils/errors');
const { loadClientForActor } = require('./clientService');

/**
 * Valida que las referencias opcionales de un asiento (appointment/treatment/plan)
 * pertenezcan al mismo tenant y cliente. Se aplica solo a las referencias que
 * vienen del body en los endpoints de cobro; el auto-cargo interno de
 * clientPlanService usa ids que él mismo acaba de generar (confiables).
 */
async function assertRefsBelong(tenantId, clientId, { appointmentId, treatmentHistoryId, clientPlanId }) {
  if (appointmentId) {
    const found = await prisma.appointment.findFirst({ where: { id: appointmentId, tenantId, clientId } });
    if (!found) throw new BadRequestError('appointmentId inválido para este cliente/tenant');
  }
  if (treatmentHistoryId) {
    const found = await prisma.treatmentHistory.findFirst({ where: { id: treatmentHistoryId, tenantId, clientId } });
    if (!found) throw new BadRequestError('treatmentHistoryId inválido para este cliente/tenant');
  }
  if (clientPlanId) {
    const found = await prisma.clientPlan.findFirst({ where: { id: clientPlanId, tenantId, clientId } });
    if (!found) throw new BadRequestError('clientPlanId inválido para este cliente/tenant');
  }
}

/**
 * Inserta un asiento en el ledger. Reusable dentro de una transacción (db = tx)
 * para el auto-cargo al contratar/renovar un plan, o directo (db = prisma) desde
 * los endpoints de cobro. Append-only: nunca actualiza ni borra asientos.
 */
async function appendEntry(db, { tenantId, clientId, type, amountUsd, description, method, createdById, appointmentId, treatmentHistoryId, clientPlanId, reversalOfId }) {
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BadRequestError('amountUsd debe ser un monto positivo');
  }
  return db.clientLedgerEntry.create({
    data: {
      tenantId,
      clientId,
      type,
      amountUsd,
      description: description ?? null,
      method: method ?? null,
      createdById,
      appointmentId: appointmentId ?? null,
      treatmentHistoryId: treatmentHistoryId ?? null,
      clientPlanId: clientPlanId ?? null,
      reversalOfId: reversalOfId ?? null,
    },
  });
}

/** Saldo derivado: SUM(cargo) − SUM(pago). Suma en centavos enteros para no arrastrar error de coma flotante. */
function computeBalance(entries) {
  const cents = entries.reduce((acc, e) => {
    const amount = Math.round(Number(e.amountUsd) * 100);
    return acc + (e.type === 'cargo' ? amount : -amount);
  }, 0);
  return cents / 100;
}

async function getBalance(actor, clientId) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;

  const entries = await prisma.clientLedgerEntry.findMany({
    where: { tenantId: client.tenantId, clientId },
    orderBy: { createdAt: 'desc' },
  });
  return { clientId, balanceUsd: computeBalance(entries), entries };
}

async function registerCharge(actor, clientId, data) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;
  await assertRefsBelong(client.tenantId, clientId, data);
  return appendEntry(prisma, {
    tenantId: client.tenantId,
    clientId,
    type: 'cargo',
    amountUsd: data.amountUsd,
    description: data.description,
    createdById: actor.id,
    appointmentId: data.appointmentId,
    treatmentHistoryId: data.treatmentHistoryId,
    clientPlanId: data.clientPlanId,
  });
}

async function registerPayment(actor, clientId, data) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;
  await assertRefsBelong(client.tenantId, clientId, data);
  return appendEntry(prisma, {
    tenantId: client.tenantId,
    clientId,
    type: 'pago',
    amountUsd: data.amountUsd,
    description: data.description,
    method: data.method,
    createdById: actor.id,
    appointmentId: data.appointmentId,
    clientPlanId: data.clientPlanId,
  });
}

/**
 * Revierte un asiento con un contra-asiento del tipo opuesto (nunca borra el
 * original — mantiene el ledger append-only). Restringido a dueno/superadmin en
 * la ruta. Rechaza revertir un asiento que ya fue revertido.
 */
async function reverseEntry(actor, entryId) {
  const original = await prisma.clientLedgerEntry.findUnique({ where: { id: entryId } });
  if (!original) return null;
  assertTenantScope(actor, original.tenantId);

  const existingReversal = await prisma.clientLedgerEntry.findUnique({ where: { reversalOfId: entryId } });
  if (existingReversal) {
    throw new BadRequestError('Este asiento ya fue revertido');
  }

  const oppositeType = original.type === 'cargo' ? 'pago' : 'cargo';
  try {
    return await appendEntry(prisma, {
      tenantId: original.tenantId,
      clientId: original.clientId,
      type: oppositeType,
      amountUsd: original.amountUsd,
      description: `Reversa de ${original.id}`,
      createdById: actor.id,
      reversalOfId: original.id,
    });
  } catch (err) {
    // Carrera: dos reversas concurrentes del mismo asiento. El @unique en
    // reversalOfId garantiza que solo una gane; la perdedora recibe P2002,
    // que traducimos al 400 amable en vez de un 500 crudo.
    if (err.code === 'P2002') {
      throw new BadRequestError('Este asiento ya fue revertido');
    }
    throw err;
  }
}

module.exports = { appendEntry, getBalance, registerCharge, registerPayment, reverseEntry };
