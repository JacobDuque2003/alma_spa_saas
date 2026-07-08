const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const ledgerService = require('./ledgerService');

test('getBalance: saldo derivado = SUM(cargo) − SUM(pago)', async () => {
  prisma.client = { findUnique: async () => ({ id: 'c1', tenantId: 't1' }) };
  prisma.clientLedgerEntry = {
    findMany: async () => [
      { type: 'cargo', amountUsd: '80.00' },
      { type: 'cargo', amountUsd: '45.50' },
      { type: 'pago', amountUsd: '100.00' },
    ],
  };

  const result = await ledgerService.getBalance({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1');
  assert.equal(result.balanceUsd, 25.5); // 80 + 45.50 − 100
});

test('registerCharge: rechaza monto no positivo', async () => {
  prisma.client = { findUnique: async () => ({ id: 'c1', tenantId: 't1' }) };
  prisma.clientLedgerEntry = { create: async ({ data }) => ({ id: 'e1', ...data }) };

  await assert.rejects(
    () => ledgerService.registerCharge({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', { amountUsd: 0 }),
    (err) => err.status === 400
  );
});

test('registerCharge: rechaza con 400 si un clientPlanId referenciado no pertenece al cliente/tenant (M1)', async () => {
  prisma.client = { findUnique: async () => ({ id: 'c1', tenantId: 't1' }) };
  prisma.clientPlan = { findFirst: async () => null }; // el clientPlanId no es de este cliente/tenant
  prisma.clientLedgerEntry = { create: async ({ data }) => ({ id: 'e1', ...data }) };

  await assert.rejects(
    () => ledgerService.registerCharge(
      { id: 'u1', tenantId: 't1', role: 'personal' },
      'c1',
      { amountUsd: 50, clientPlanId: 'plan-de-otro-tenant' }
    ),
    (err) => err.status === 400
  );
});

test('reverseEntry: agrega un contra-asiento del tipo opuesto (no borra el original)', async () => {
  let created = null;
  prisma.clientLedgerEntry = {
    findUnique: async (args) => {
      if (args.where.id === 'e1') return { id: 'e1', tenantId: 't1', clientId: 'c1', type: 'pago', amountUsd: '50.00' };
      if (args.where.reversalOfId === 'e1') return null; // aún no revertido
      return null;
    },
    create: async ({ data }) => { created = data; return { id: 'e2', ...data }; },
  };

  await ledgerService.reverseEntry({ id: 'dueno1', tenantId: 't1', role: 'dueno' }, 'e1');
  assert.equal(created.type, 'cargo'); // opuesto de pago
  assert.equal(created.reversalOfId, 'e1');
  assert.equal(String(created.amountUsd), '50.00');
});

test('reverseEntry: rechaza revertir un asiento ya revertido', async () => {
  prisma.clientLedgerEntry = {
    findUnique: async (args) => {
      if (args.where.id === 'e1') return { id: 'e1', tenantId: 't1', clientId: 'c1', type: 'pago', amountUsd: '50.00' };
      if (args.where.reversalOfId === 'e1') return { id: 'e2' }; // ya existe reversa
      return null;
    },
  };

  await assert.rejects(
    () => ledgerService.reverseEntry({ id: 'dueno1', tenantId: 't1', role: 'dueno' }, 'e1'),
    (err) => err.status === 400
  );
});
