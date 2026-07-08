const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const clientPlanService = require('./clientPlanService');

function mockContractDeps() {
  prisma.client = { findUnique: async () => ({ id: 'c1', tenantId: 't1' }) };
  prisma.plan = { findFirst: async () => ({ id: 'p1', tenantId: 't1', name: 'Plan mensual', sessionsIncluded: 4, priceUsd: '80.00', period: 'mensual', active: true }) };
}

// $transaction que registra si se creó un asiento de ledger.
function txSpy(state) {
  return async (cb) => cb({
    clientPlan: {
      create: async ({ data }) => ({ id: 'cp1', ...data }),
      update: async ({ data }) => ({ id: 'cp1', clientId: 'c1', tenantId: 't1', priceUsd: '80.00', periodMonths: 1, sessionsIncluded: 4, ...data }),
    },
    clientLedgerEntry: { create: async ({ data }) => { state.charge = data; return { id: 'e1', ...data }; } },
  });
}

test('contractPlan: genera el cargo automáticamente (D7) para un actor normal', async () => {
  mockContractDeps();
  const state = {};
  prisma.$transaction = txSpy(state);

  const dto = await clientPlanService.contractPlan({ id: 'recep1', tenantId: 't1', role: 'personal' }, 'c1', { planId: 'p1' });
  assert.ok(state.charge, 'debió generarse el cargo');
  assert.equal(state.charge.type, 'cargo');
  assert.equal(String(state.charge.amountUsd), '80.00');
  assert.equal(dto.sessionsRemaining, 4);
});

test('contractPlan: personal NO puede marcar cortesía — el cargo se genera igual (D7)', async () => {
  mockContractDeps();
  const state = {};
  prisma.$transaction = txSpy(state);

  await clientPlanService.contractPlan({ id: 'recep1', tenantId: 't1', role: 'personal' }, 'c1', { planId: 'p1', isComplimentary: true });
  assert.ok(state.charge, 'la bandera isComplimentary de un personal debe ignorarse y generarse el cargo');
});

test('contractPlan: dueño SÍ puede marcar cortesía — no se genera cargo (D7)', async () => {
  mockContractDeps();
  const state = {};
  prisma.$transaction = txSpy(state);

  const dto = await clientPlanService.contractPlan({ id: 'dueno1', tenantId: 't1', role: 'dueno' }, 'c1', { planId: 'p1', isComplimentary: true });
  assert.equal(state.charge, undefined, 'no debe generarse cargo en cortesía autorizada');
  assert.equal(dto.isComplimentary, true);
});

test('consumeSession: rechaza cuando ya se agotaron las sesiones del periodo (updateMany afecta 0 filas)', async () => {
  prisma.clientPlan = {
    findUnique: async () => ({ id: 'cp1', tenantId: 't1', active: true, sessionsUsed: 4, sessionsIncluded: 4 }),
    updateMany: async () => ({ count: 0 }), // el WHERE condicional no encontró fila con sesiones disponibles
  };

  await assert.rejects(
    () => clientPlanService.consumeSession({ id: 'u1', tenantId: 't1', role: 'personal' }, 'cp1'),
    (err) => err.status === 400
  );
});

test('consumeSession: incrementa el contador (condicional atómico) cuando quedan sesiones', async () => {
  let capturedWhere = null;
  const states = [
    { id: 'cp1', tenantId: 't1', active: true, sessionsUsed: 1, sessionsIncluded: 4 }, // lectura inicial
    { id: 'cp1', tenantId: 't1', active: true, sessionsUsed: 2, sessionsIncluded: 4 }, // relectura tras el update
  ];
  let call = 0;
  prisma.clientPlan = {
    findUnique: async () => states[Math.min(call++, states.length - 1)],
    updateMany: async (args) => { capturedWhere = args.where; return { count: 1 }; },
  };

  const dto = await clientPlanService.consumeSession({ id: 'u1', tenantId: 't1', role: 'personal' }, 'cp1');
  assert.deepEqual(capturedWhere.sessionsUsed, { lt: 4 }); // re-verifica el límite en el WHERE
  assert.equal(dto.sessionsRemaining, 2);
});

test('renewPlan: resetea el contador y genera el cargo del nuevo periodo (D7)', async () => {
  prisma.clientPlan = { findUnique: async () => ({ id: 'cp1', tenantId: 't1', clientId: 'c1', priceUsd: '80.00', periodMonths: 1 }) };
  const state = {};
  prisma.$transaction = txSpy(state);

  const dto = await clientPlanService.renewPlan({ id: 'recep1', tenantId: 't1', role: 'personal' }, 'cp1', {});
  assert.equal(dto.sessionsUsed, 0);
  assert.ok(state.charge, 'la renovación debe generar el cargo del nuevo periodo');
});
