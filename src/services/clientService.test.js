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
  assert.deepEqual(result, { exists: true, requiresIntake: true });
});

test('lookupClient devuelve requiresIntake=false si el cliente ya firmó consentimiento', async () => {
  prisma.client = {
    findUnique: async () => ({ id: 'c1', intake: { consentSigned: true } }),
  };
  const result = await clientService.lookupClient('t1', '+593999000001');
  assert.deepEqual(result, { exists: true, requiresIntake: false });
});

test('M-2: lookupClient NO expone clientId en la respuesta pública', async () => {
  prisma.client = {
    findUnique: async () => ({ id: 'clientId-secreto', intake: { consentSigned: true } }),
  };
  const result = await clientService.lookupClient('t1', '+593999000001');
  assert.ok(!('clientId' in result), 'la respuesta pública NO debe incluir clientId');
  assert.equal(result.exists, true);
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

test('listClients puede listar deshabilitados sin filtrar ClientIntake', async () => {
  let argsSeen = null;
  prisma.client = {
    findMany: async (args) => {
      argsSeen = args;
      return [{ id: 'c2', tenantId: 't1', fullName: 'Cliente Inactiva', whatsapp: '+593', email: null, active: false }];
    },
  };

  const result = await clientService.listClients({ role: 'dueno', tenantId: 't1' }, { active: 'false' });
  assert.equal(argsSeen.where.tenantId, 't1');
  assert.equal(argsSeen.where.active, false);
  assert.equal(argsSeen.select.fullName, true);
  assert.equal('intake' in argsSeen.select, false);
  assert.equal(result[0].active, false);
});

test('listClients active=all lista activas y deshabilitadas sin filtrar ClientIntake', async () => {
  let argsSeen = null;
  prisma.client = {
    findMany: async (args) => {
      argsSeen = args;
      return [];
    },
  };

  await clientService.listClients({ role: 'dueno', tenantId: 't1' }, { active: 'all', limit: 300 });
  assert.equal(argsSeen.where.tenantId, 't1');
  assert.equal('active' in argsSeen.where, false);
  assert.equal(argsSeen.take, 300);
  assert.equal(argsSeen.select.fullName, true);
  assert.equal('intake' in argsSeen.select, false);
  assert.equal('allergiesEnc' in argsSeen.select, false);
});

test('searchClients devuelve DTO mínimo tenant-scoped y busca por teléfono local', async () => {
  let argsSeen = null;
  prisma.client = {
    findMany: async (args) => {
      argsSeen = args;
      return [{ id: 'c1', fullName: 'Jacob Duque', whatsapp: '+593993629256' }];
    },
  };

  const result = await clientService.searchClients({ role: 'personal', tenantId: 't1' }, { q: '0993629256', limit: 50 });

  assert.equal(argsSeen.where.tenantId, 't1');
  assert.equal(argsSeen.where.active, true);
  assert.equal(argsSeen.take, 10);
  assert.equal(argsSeen.select.id, true);
  assert.equal(argsSeen.select.recordNumber, true);
  assert.equal('email' in argsSeen.select, false);
  assert.equal('intake' in argsSeen.select, false);
  assert.deepEqual(result, [{ type: 'client', id: 'c1', name: 'Jacob Duque', phone: '+593993629256', recordNumber: undefined }]);
});

test('searchClients no lista todo si q tiene menos de 2 caracteres', async () => {
  let called = false;
  prisma.client = { findMany: async () => { called = true; return []; } };

  const result = await clientService.searchClients({ role: 'personal', tenantId: 't1' }, { q: 'J' });

  assert.deepEqual(result, []);
  assert.equal(called, false);
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
