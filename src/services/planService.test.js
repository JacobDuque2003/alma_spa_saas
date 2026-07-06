const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const planService = require('./planService');

function mockPrisma({ service = {}, plan = {} } = {}) {
  prisma.service = service;
  prisma.plan = plan;
}

test('createPlan rechaza con 400 si algún serviceId no pertenece al tenant del actor', async () => {
  mockPrisma({
    // Solo uno de los dos ids "pertenece" al tenant -> longitud no coincide.
    service: { findMany: async () => [{ id: 'srv-propio' }] },
  });

  await assert.rejects(
    () =>
      planService.createPlan(
        { role: 'dueno', tenantId: 't1' },
        {
          name: 'Plan mensual',
          sessionsIncluded: 4,
          period: 'mensual',
          priceUsd: 80,
          appliesToAllServices: false,
          serviceIds: ['srv-propio', 'srv-de-otro-tenant'],
        }
      ),
    (err) => err.status === 400
  );
});

test('createPlan crea el plan cuando todos los serviceIds pertenecen al tenant del actor', async () => {
  mockPrisma({
    service: { findMany: async () => [{ id: 'srv1' }, { id: 'srv2' }] },
    plan: { create: async (args) => ({ id: 'plan1', ...args.data }) },
  });

  const result = await planService.createPlan(
    { role: 'dueno', tenantId: 't1' },
    {
      name: 'Plan mensual',
      sessionsIncluded: 4,
      period: 'mensual',
      priceUsd: 80,
      appliesToAllServices: false,
      serviceIds: ['srv1', 'srv2'],
    }
  );

  assert.equal(result.tenantId, 't1');
  assert.equal(result.appliesToAllServices, false);
});

test('createPlan ignora serviceIds cuando appliesToAllServices es true', async () => {
  mockPrisma({
    service: {
      findMany: async () => {
        throw new Error('no debería consultarse Service cuando appliesToAllServices=true');
      },
    },
    plan: { create: async (args) => ({ id: 'plan1', ...args.data }) },
  });

  const result = await planService.createPlan(
    { role: 'dueno', tenantId: 't1' },
    {
      name: 'Plan mensual',
      sessionsIncluded: 4,
      period: 'mensual',
      priceUsd: 80,
      appliesToAllServices: true,
      serviceIds: ['id-que-se-ignora'],
    }
  );

  assert.equal(result.appliesToAllServices, true);
});

test('createPlan ignora un tenantId forjado y usa el del JWT del actor', async () => {
  mockPrisma({
    plan: { create: async (args) => ({ id: 'plan1', ...args.data }) },
  });

  const result = await planService.createPlan(
    { role: 'dueno', tenantId: 'tenant-real' },
    {
      name: 'Plan mensual',
      sessionsIncluded: 4,
      period: 'mensual',
      priceUsd: 80,
      tenantId: 'tenant-forjado',
    }
  );

  assert.equal(result.tenantId, 'tenant-real');
});
