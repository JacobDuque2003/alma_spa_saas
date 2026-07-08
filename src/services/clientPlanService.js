const prisma = require('../utils/prisma');
const { assertTenantScope } = require('../utils/tenantScope');
const { BadRequestError } = require('../utils/errors');
const ledgerService = require('./ledgerService');
const { loadClientForActor } = require('./clientService');

const PERIOD_MONTHS_BY_LABEL = {
  mensual: 1,
  bimestral: 2,
  trimestral: 3,
  cuatrimestral: 4,
  semestral: 6,
  anual: 12,
};

function resolvePeriodMonths(bodyValue, planPeriodLabel) {
  if (Number.isInteger(bodyValue) && bodyValue > 0) return bodyValue;
  const parsed = PERIOD_MONTHS_BY_LABEL[String(planPeriodLabel || '').toLowerCase()];
  return parsed || 1;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// Solo dueno/superadmin pueden marcar un periodo como cortesía (sin cargo).
// Para personal, la bandera se ignora aunque venga en el body (mismo patrón
// que el tenantId forjado de fases anteriores).
function resolveComplimentary(actor, requested) {
  const canGrant = actor.role === 'superadmin' || actor.role === 'dueno';
  return canGrant && !!requested;
}

function toDTO(plan) {
  return { ...plan, sessionsRemaining: plan.sessionsIncluded - plan.sessionsUsed };
}

async function listPlans(actor, clientId) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;
  const plans = await prisma.clientPlan.findMany({
    where: { tenantId: client.tenantId, clientId },
    orderBy: { createdAt: 'desc' },
  });
  return plans.map(toDTO);
}

/**
 * Contrata un Plan para un cliente. Genera el cargo en el ledger AUTOMÁTICAMENTE
 * dentro de la misma transacción (D7) salvo que un dueno/superadmin lo marque
 * como cortesía. Nunca queda un plan activo sin su cargo.
 */
async function contractPlan(actor, clientId, data) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;

  if (!data.planId) {
    throw new BadRequestError('planId es requerido');
  }
  const plan = await prisma.plan.findFirst({
    where: { id: data.planId, tenantId: client.tenantId, active: true },
  });
  if (!plan) {
    throw new BadRequestError('planId inválido para este tenant');
  }

  const periodMonths = resolvePeriodMonths(data.periodMonths, plan.period);
  const isComplimentary = resolveComplimentary(actor, data.isComplimentary);
  const periodStart = new Date();
  const renewsAt = addMonths(periodStart, periodMonths);

  return prisma.$transaction(async (tx) => {
    const clientPlan = await tx.clientPlan.create({
      data: {
        tenantId: client.tenantId,
        clientId,
        planId: plan.id,
        sessionsIncluded: plan.sessionsIncluded,
        priceUsd: plan.priceUsd,
        periodMonths,
        sessionsUsed: 0,
        periodStart,
        renewsAt,
        isComplimentary,
      },
    });

    if (!isComplimentary) {
      await ledgerService.appendEntry(tx, {
        tenantId: client.tenantId,
        clientId,
        type: 'cargo',
        amountUsd: plan.priceUsd,
        description: `Contratación de plan: ${plan.name}`,
        createdById: actor.id,
        clientPlanId: clientPlan.id,
      });
    }

    return toDTO(clientPlan);
  });
}

async function consumeSession(actor, clientPlanId) {
  const clientPlan = await prisma.clientPlan.findUnique({ where: { id: clientPlanId } });
  if (!clientPlan) return null;
  assertTenantScope(actor, clientPlan.tenantId);

  if (!clientPlan.active) {
    throw new BadRequestError('El plan no está activo');
  }

  // Incremento condicional atómico: el WHERE re-verifica sessionsUsed contra el
  // límite (valor literal) en la misma operación, así dos consumos concurrentes
  // no pueden sobrepasar sessionsIncluded (el segundo afecta 0 filas).
  const result = await prisma.clientPlan.updateMany({
    where: { id: clientPlanId, sessionsUsed: { lt: clientPlan.sessionsIncluded } },
    data: { sessionsUsed: { increment: 1 } },
  });
  if (result.count === 0) {
    throw new BadRequestError('No quedan sesiones disponibles en el periodo actual');
  }

  const updated = await prisma.clientPlan.findUnique({ where: { id: clientPlanId } });
  return toDTO(updated);
}

/**
 * Renueva el periodo: resetea el contador y avanza las fechas. Genera el cargo
 * del nuevo periodo automáticamente (D7), misma regla de cortesía que contratar.
 */
async function renewPlan(actor, clientPlanId, data) {
  const clientPlan = await prisma.clientPlan.findUnique({ where: { id: clientPlanId } });
  if (!clientPlan) return null;
  assertTenantScope(actor, clientPlan.tenantId);

  const isComplimentary = resolveComplimentary(actor, data.isComplimentary);
  const periodStart = new Date();
  const renewsAt = addMonths(periodStart, clientPlan.periodMonths);

  return prisma.$transaction(async (tx) => {
    const renewed = await tx.clientPlan.update({
      where: { id: clientPlanId },
      data: { sessionsUsed: 0, periodStart, renewsAt, isComplimentary, active: true },
    });

    if (!isComplimentary) {
      await ledgerService.appendEntry(tx, {
        tenantId: clientPlan.tenantId,
        clientId: clientPlan.clientId,
        type: 'cargo',
        amountUsd: clientPlan.priceUsd,
        description: 'Renovación de plan',
        createdById: actor.id,
        clientPlanId: clientPlan.id,
      });
    }

    return toDTO(renewed);
  });
}

module.exports = { listPlans, contractPlan, consumeSession, renewPlan };
