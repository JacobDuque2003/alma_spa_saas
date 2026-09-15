const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const tenantAdminService = require('./tenantAdminService');

const superadmin = { id: 'root', email: 'root@nuvio.test', role: 'superadmin', tenantId: null };
const owner = { id: 'owner', email: 'owner@alma.test', role: 'dueno', tenantId: 't1' };

function mockPrisma(overrides) {
  prisma.$transaction = async (fn) => fn(prisma);
  Object.assign(prisma, overrides);
}

test('updateTenantBilling solo permite superadmin', async () => {
  await assert.rejects(
    () => tenantAdminService.updateTenantBilling(owner, 't1', { billingStatus: 'suspended' }),
    (err) => err.status === 403
  );
});

test('updateTenantBilling suspende tenant, invalida sesiones y escribe audit log', async () => {
  const auditRows = [];
  let updateManyArgs = null;
  mockPrisma({
    tenant: {
      findUnique: async () => ({
        id: 't1',
        name: 'ALMA SPA',
        slug: 'alma',
        plan: 'trial',
        active: true,
        billingStatus: 'active',
        billingDueAt: null,
        billingGraceUntil: null,
        suspendedAt: null,
        suspensionReason: null,
      }),
      update: async (args) => ({
        id: 't1',
        name: 'ALMA SPA',
        slug: 'alma',
        plan: 'pro',
        active: true,
        billingStatus: args.data.billingStatus,
        billingDueAt: args.data.billingDueAt,
        billingGraceUntil: args.data.billingGraceUntil,
        suspendedAt: args.data.suspendedAt,
        suspensionReason: args.data.suspensionReason,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-15T00:00:00.000Z'),
        _count: { users: 4, whatsappConversations: 12 },
      }),
    },
    user: {
      updateMany: async (args) => {
        updateManyArgs = args;
        return { count: 4 };
      },
    },
    adminAuditLog: {
      create: async (args) => {
        auditRows.push(args.data);
        return { id: 'audit1', ...args.data };
      },
    },
  });

  const result = await tenantAdminService.updateTenantBilling(superadmin, 't1', {
    plan: 'pro',
    billingStatus: 'suspended',
    billingDueAt: '2026-09-30T12:00:00.000Z',
    suspensionReason: 'Mensualidad pendiente',
  });

  assert.equal(result.billingStatus, 'suspended');
  assert.equal(result.plan, 'pro');
  assert.equal(updateManyArgs.where.tenantId, 't1');
  assert.deepEqual(updateManyArgs.data, { sessionVersion: { increment: 1 } });
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].entity, 'tenant');
  assert.equal(auditRows[0].action, 'billingStatusChanged');
  assert.equal(auditRows[0].tenantId, 't1');
  assert.equal(auditRows[0].actorId, 'root');
});

test('updateTenantBilling rechaza estado inválido', async () => {
  await assert.rejects(
    () => tenantAdminService.updateTenantBilling(superadmin, 't1', { billingStatus: 'paused' }),
    (err) => err.status === 400 && /billingStatus/.test(err.message)
  );
});
