const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const clientService = require('./clientService');

const actor = { role: 'dueno', tenantId: 't1' };

test('listClients: búsqueda por teléfono en formato local Ecuador (con leading 0) encuentra +593...', async () => {
  let whereSeen = null;
  prisma.client = {
    findMany: async (args) => {
      whereSeen = args.where;
      // Simulamos la BD: comparar el patrón endsWith contra Jacob
      const jacob = { id: 'c1', tenantId: 't1', fullName: 'Jacob Duque', whatsapp: '+593993629256', email: null };
      const matches = args.where.OR.some((c) => {
        if (c.whatsapp?.endsWith) return jacob.whatsapp.endsWith(c.whatsapp.endsWith);
        if (c.whatsapp?.contains) return jacob.whatsapp.includes(c.whatsapp.contains);
        return false;
      });
      return matches ? [jacob] : [];
    },
  };

  const result = await clientService.listClients(actor, { q: '0993629256' });
  assert.equal(result.length, 1);
  assert.equal(result[0].fullName, 'Jacob Duque');
  // El OR debe incluir un endsWith sin el leading 0
  const endsWithClause = whereSeen.OR.find((c) => c.whatsapp?.endsWith);
  assert.ok(endsWithClause, 'debe existir cláusula endsWith');
  assert.equal(endsWithClause.whatsapp.endsWith, '993629256');
});

test('listClients: búsqueda con solo 6 dígitos NO agrega cláusula endsWith (demasiado corto)', async () => {
  let whereSeen = null;
  prisma.client = {
    findMany: async (args) => { whereSeen = args.where; return []; },
  };
  await clientService.listClients(actor, { q: '123456' });
  const endsWith = whereSeen.OR.find((c) => c.whatsapp?.endsWith);
  assert.equal(endsWith, undefined, 'no debería añadir endsWith para 6 dígitos');
});

test('listClients: búsqueda por nombre no genera cláusula endsWith', async () => {
  let whereSeen = null;
  prisma.client = { findMany: async (args) => { whereSeen = args.where; return []; } };
  await clientService.listClients(actor, { q: 'Jacob' });
  const endsWith = whereSeen.OR.find((c) => c.whatsapp?.endsWith);
  assert.equal(endsWith, undefined);
});

test('createClient: colisión de whatsapp devuelve mensaje con nombre existente', async () => {
  prisma.client = {
    create: async () => {
      const err = new Error('Unique constraint');
      err.code = 'P2002';
      throw err;
    },
    findUnique: async () => ({ fullName: 'Jacob Duque' }),
  };

  await assert.rejects(
    () => clientService.createClient(actor, { fullName: 'Otra', whatsapp: '+593993629256' }),
    (err) => err.status === 400 && /Jacob Duque/.test(err.message),
  );
});

test('createClient: colisión sin cliente hallable devuelve mensaje genérico "otra clienta"', async () => {
  prisma.client = {
    create: async () => {
      const err = new Error('Unique constraint');
      err.code = 'P2002';
      throw err;
    },
    findUnique: async () => null,
  };

  await assert.rejects(
    () => clientService.createClient(actor, { fullName: 'Otra', whatsapp: '+593993629256' }),
    (err) => err.status === 400 && /otra clienta/.test(err.message),
  );
});

test('createClient: errores que no son P2002 se propagan sin ser reescritos', async () => {
  const original = new Error('DB caída');
  original.code = 'P1001';
  prisma.client = {
    create: async () => { throw original; },
    findUnique: async () => { throw new Error('no debería llamarse'); },
  };

  await assert.rejects(
    () => clientService.createClient(actor, { fullName: 'x', whatsapp: '+593999999999' }),
    (err) => err === original,
  );
});
