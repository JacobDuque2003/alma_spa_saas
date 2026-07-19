const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const clientService = require('./clientService');

// --- Helpers ---

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const CLIENT_ID = 'client-1';

const actorA = { id: 'user-a', tenantId: TENANT_A, role: 'personal' };
const actorB = { id: 'user-b', tenantId: TENANT_B, role: 'personal' };

function mockClientInTenantA(overrides = {}) {
  const base = {
    id: CLIENT_ID,
    tenantId: TENANT_A,
    fullName: 'María Pérez',
    whatsapp: '+593999000001',
    email: 'maria@test.com',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  prisma.client = {
    findUnique: async () => base,
    update: async ({ data }) => ({ ...base, ...data }),
  };
  return base;
}

// --- Test: cross-tenant 403 ---

test('updateClient: actor from tenant B gets 403 when updating client from tenant A', async () => {
  mockClientInTenantA();

  await assert.rejects(
    () => clientService.updateClient(actorB, CLIENT_ID, { fullName: 'Hacked' }),
    (err) => {
      assert.equal(err.status, 403);
      return true;
    }
  );
});

// --- Test: invalid WhatsApp format ---

test('updateClient: invalid WhatsApp format (not-a-phone) rejected with 400', async () => {
  mockClientInTenantA();

  await assert.rejects(
    () => clientService.updateClient(actorA, CLIENT_ID, { whatsapp: 'not-a-phone' }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /WhatsApp/i);
      return true;
    }
  );
});

test('updateClient: WhatsApp too short (less than 7 digits) rejected with 400', async () => {
  mockClientInTenantA();

  await assert.rejects(
    () => clientService.updateClient(actorA, CLIENT_ID, { whatsapp: '+123' }),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test('updateClient: WhatsApp starting with +0 rejected with 400', async () => {
  mockClientInTenantA();

  await assert.rejects(
    () => clientService.updateClient(actorA, CLIENT_ID, { whatsapp: '+0999000001' }),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    }
  );
});

// --- Test: invalid email format ---

test('updateClient: invalid email format rejected with 400', async () => {
  mockClientInTenantA();

  await assert.rejects(
    () => clientService.updateClient(actorA, CLIENT_ID, { email: 'not-an-email' }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /email/i);
      return true;
    }
  );
});

test('updateClient: email without TLD rejected with 400', async () => {
  mockClientInTenantA();

  await assert.rejects(
    () => clientService.updateClient(actorA, CLIENT_ID, { email: 'user@host' }),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    }
  );
});

// --- Test: valid update succeeds ---

test('updateClient: valid update succeeds (happy path)', async () => {
  const base = mockClientInTenantA();
  let updateData = null;
  prisma.client.update = async ({ data }) => {
    updateData = data;
    return { ...base, ...data };
  };

  const result = await clientService.updateClient(actorA, CLIENT_ID, {
    fullName: 'María Actualizada',
    whatsapp: '+593998111222',
    email: 'nueva@test.com',
  });

  assert.equal(result.fullName, 'María Actualizada');
  assert.equal(updateData.whatsapp, '+593998111222');
  assert.equal(updateData.email, 'nueva@test.com');
});

test('updateClient: clearing email (empty string) sets null', async () => {
  const base = mockClientInTenantA();
  let updateData = null;
  prisma.client.update = async ({ data }) => {
    updateData = data;
    return { ...base, ...data };
  };

  await clientService.updateClient(actorA, CLIENT_ID, { email: '' });
  assert.equal(updateData.email, null);
});

// --- Test: cannot change tenantId via PATCH ---

test('updateClient: tenantId in body is silently ignored (mass-assignment protection)', async () => {
  const base = mockClientInTenantA();
  let updateData = null;
  prisma.client.update = async ({ data }) => {
    updateData = data;
    return { ...base, ...data };
  };

  const result = await clientService.updateClient(actorA, CLIENT_ID, {
    tenantId: 'malicious-tenant',
    id: 'malicious-id',
    active: false,
    fullName: 'Legit Change',
  });

  // Only fullName should be in the update payload
  assert.equal(updateData.fullName, 'Legit Change');
  assert.equal(updateData.tenantId, undefined);
  assert.equal(updateData.id, undefined);
  assert.equal(updateData.active, undefined);
  // The returned tenantId must still be the original
  assert.equal(result.tenantId, TENANT_A);
});

// --- Test: superadmin bypasses tenant check ---

test('updateClient: superadmin can update client in any tenant', async () => {
  const base = mockClientInTenantA();
  prisma.client.update = async ({ data }) => ({ ...base, ...data });

  const superadmin = { id: 'sa-1', role: 'superadmin', tenantId: null };
  const result = await clientService.updateClient(superadmin, CLIENT_ID, {
    fullName: 'Superadmin Edit',
  });
  assert.equal(result.fullName, 'Superadmin Edit');
});
