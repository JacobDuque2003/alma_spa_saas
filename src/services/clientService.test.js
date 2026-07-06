const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const clientService = require('./clientService');

test('lookupClient devuelve exists=false y requiresIntake=true cuando el cliente no existe', async () => {
  prisma.client = { findUnique: async () => null };
  const result = await clientService.lookupClient('t1', '+593999000001');
  assert.deepEqual(result, { exists: false, requiresIntake: true });
});

test('lookupClient devuelve requiresIntake=true si el cliente existe pero no firmó consentimiento', async () => {
  prisma.client = {
    findUnique: async () => ({ id: 'c1', intake: { consentSigned: false } }),
  };
  const result = await clientService.lookupClient('t1', '+593999000001');
  assert.deepEqual(result, { exists: true, clientId: 'c1', requiresIntake: true });
});

test('lookupClient devuelve requiresIntake=false si el cliente ya firmó consentimiento', async () => {
  prisma.client = {
    findUnique: async () => ({ id: 'c1', intake: { consentSigned: true } }),
  };
  const result = await clientService.lookupClient('t1', '+593999000001');
  assert.deepEqual(result, { exists: true, clientId: 'c1', requiresIntake: false });
});
