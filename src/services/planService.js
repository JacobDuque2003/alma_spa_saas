const prisma = require('../utils/prisma');
const { assertTenantScope, resolveTenantId } = require('../utils/tenantScope');
const { BadRequestError } = require('../utils/errors');

async function resolveServiceConnections(tenantId, appliesToAllServices, serviceIds) {
  if (appliesToAllServices) {
    // serviceIds (si vino) se ignora por completo: no aplica cuando es para todos.
    return undefined;
  }

  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    throw new BadRequestError('serviceIds es requerido cuando appliesToAllServices es false');
  }

  // Evita que un actor conecte servicios de OTRO tenant vía el array de la relación.
  const owned = await prisma.service.findMany({
    where: { id: { in: serviceIds }, tenantId },
    select: { id: true },
  });
  if (owned.length !== serviceIds.length) {
    throw new BadRequestError('Alguno de los serviceIds no existe o no pertenece a este tenant');
  }

  return { connect: serviceIds.map((id) => ({ id })) };
}

async function listPlans(actor, query) {
  const where = {};
  if (actor.role === 'superadmin') {
    if (query.tenantId) where.tenantId = query.tenantId;
  } else {
    where.tenantId = actor.tenantId;
  }
  return prisma.plan.findMany({ where, include: { services: true } });
}

async function getPlan(actor, id) {
  const plan = await prisma.plan.findUnique({ where: { id }, include: { services: true } });
  if (!plan) return null;
  assertTenantScope(actor, plan.tenantId);
  return plan;
}

async function createPlan(actor, data) {
  const tenantId = resolveTenantId(actor, data.tenantId);
  if (!tenantId) {
    throw new BadRequestError('tenantId es requerido');
  }
  if (!data.name || !data.sessionsIncluded || !data.period || data.priceUsd === undefined) {
    throw new BadRequestError('name, sessionsIncluded, period y priceUsd son requeridos');
  }

  const appliesToAllServices = data.appliesToAllServices !== false;
  const servicesConnect = await resolveServiceConnections(tenantId, appliesToAllServices, data.serviceIds);

  return prisma.plan.create({
    data: {
      tenantId,
      name: data.name,
      sessionsIncluded: data.sessionsIncluded,
      period: data.period,
      priceUsd: data.priceUsd,
      appliesToAllServices,
      includesHomeService: !!data.includesHomeService,
      active: true,
      ...(servicesConnect ? { services: servicesConnect } : {}),
    },
    include: { services: true },
  });
}

async function updatePlan(actor, id, changes) {
  const target = await prisma.plan.findUnique({ where: { id } });
  if (!target) return null;
  assertTenantScope(actor, target.tenantId);

  const data = {};
  if (changes.name !== undefined) data.name = changes.name;
  if (changes.sessionsIncluded !== undefined) data.sessionsIncluded = changes.sessionsIncluded;
  if (changes.period !== undefined) data.period = changes.period;
  if (changes.priceUsd !== undefined) data.priceUsd = changes.priceUsd;
  if (changes.includesHomeService !== undefined) data.includesHomeService = changes.includesHomeService;

  if (changes.appliesToAllServices !== undefined) {
    data.appliesToAllServices = changes.appliesToAllServices;
    if (changes.appliesToAllServices === false) {
      const servicesConnect = await resolveServiceConnections(target.tenantId, false, changes.serviceIds);
      data.services = { set: [], ...servicesConnect };
    } else {
      data.services = { set: [] };
    }
  }

  return prisma.plan.update({ where: { id }, data, include: { services: true } });
}

async function deletePlan(actor, id) {
  const target = await prisma.plan.findUnique({ where: { id } });
  if (!target) return null;
  assertTenantScope(actor, target.tenantId);

  return prisma.plan.update({ where: { id }, data: { active: false } });
}

module.exports = { listPlans, getPlan, createPlan, updatePlan, deletePlan };
