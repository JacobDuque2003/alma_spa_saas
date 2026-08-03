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


test('listClients filtra por tenant del actor y usa select seguro sin ClientIntake', async () => {
  let argsSeen = null;
  prisma.client = {
    findMany: async (args) => {
      argsSeen = args;
      return [{ id: 'c1', tenantId: 't1', fullName: 'Camila Andrade', whatsapp: '+593', email: null }];
    },
  };

  const result = await clientService.listClients({ role: 'personal', tenantId: 't1' }, { q: 'Camila' });
  assert.equal(argsSeen.where.tenantId, 't1');
  assert.equal(argsSeen.where.active, true);
  assert.equal(argsSeen.select.fullName, true);
  assert.equal('intake' in argsSeen.select, false);
  assert.equal('allergiesEnc' in argsSeen.select, false);
  assert.equal(result[0].fullName, 'Camila Andrade');
});

test('getClient rechaza cross-tenant con 403 y no incluye ClientIntake en el select', async () => {
  let argsSeen = null;
  prisma.client = {
    findUnique: async (args) => {
      argsSeen = args;
      return { id: 'c-ajeno', tenantId: 'tenant-ajeno', fullName: 'Ajena', whatsapp: '+593' };
    },
  };

  await assert.rejects(
    () => clientService.getClient({ role: 'personal', tenantId: 'tenant-propio' }, 'c-ajeno'),
    (err) => err.status === 403
  );
  assert.equal(argsSeen.select.fullName, true);
  assert.equal('intake' in argsSeen.select, false);
});

test('deleteClient desactiva el cliente sin borrar su historial', async () => {
  const calls = [];
  prisma.client = {
    findUnique: async (args) => {
      calls.push(['findUnique', args]);
      return { id: 'c1', tenantId: 't1', fullName: 'Camila Andrade', whatsapp: '+593', active: true };
    },
    update: async (args) => {
      calls.push(['update', args]);
      return { id: 'c1', tenantId: 't1', fullName: 'Camila Andrade', whatsapp: '+593', email: null, birthday: null, active: false };
    },
  };

  const result = await clientService.deleteClient({ role: 'dueno', tenantId: 't1' }, 'c1');
  const updateCall = calls.find(([name]) => name === 'update')[1];
  assert.deepEqual(updateCall.data, { active: false });
  assert.equal(updateCall.select.fullName, true);
  assert.equal('intake' in updateCall.select, false);
  assert.equal(result.active, false);
});
