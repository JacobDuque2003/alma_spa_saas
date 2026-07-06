const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const serviceService = require('./serviceService');

function mockPrisma({ service = {}, room = {} } = {}) {
  prisma.service = service;
  prisma.room = room;
}

test('createService ignora un tenantId forjado en el body y usa el del JWT del actor', async () => {
  mockPrisma({ service: { create: async (args) => ({ id: 'nuevo', ...args.data }) } });

  const result = await serviceService.createService(
    { role: 'dueno', tenantId: 'tenant-real-del-jwt' },
    { name: 'Masaje relajante', category: 'masajes', priceUsd: 45, tenantId: 'tenant-forjado' }
  );

  assert.equal(result.tenantId, 'tenant-real-del-jwt');
});

test('createService siempre fuerza durationMins a 60 sin importar lo que mande el cliente', async () => {
  mockPrisma({ service: { create: async (args) => ({ id: 'nuevo', ...args.data }) } });

  const result = await serviceService.createService(
    { role: 'dueno', tenantId: 't1' },
    { name: 'Facial', category: 'faciales', priceUsd: 30, durationMins: 999 }
  );

  assert.equal(result.durationMins, 60);
});

test('updateService rechaza con 403 si el actor intenta tocar un servicio de otro tenant', async () => {
  mockPrisma({
    service: { findUnique: async () => ({ id: 's1', tenantId: 'tenant-otro' }) },
  });

  await assert.rejects(
    () => serviceService.updateService({ role: 'dueno', tenantId: 'tenant-propio' }, 's1', { name: 'x' }),
    (err) => err.status === 403
  );
});

test('deleteService hace soft delete (active=false) cuando hay otra service activa de la misma category', async () => {
  mockPrisma({
    service: {
      findUnique: async () => ({ id: 's1', tenantId: 't1', category: 'masajes' }),
      count: async () => 1, // otra service activa de la misma category ya cubre a los gabinetes
      update: async (args) => ({ id: 's1', ...args.data }),
    },
  });

  const result = await serviceService.deleteService({ role: 'dueno', tenantId: 't1' }, 's1');
  assert.equal(result.active, false);
});

test('deleteService rechaza con 400 si es la última service activa de la category y un room activo depende de ella', async () => {
  mockPrisma({
    service: {
      findUnique: async () => ({ id: 's1', tenantId: 't1', category: 'masajes' }),
      count: async () => 0, // ninguna otra service activa de "masajes"
    },
    room: {
      findFirst: async () => ({ id: 'room1', name: 'Sala de masajes', specialty: 'masajes', active: true }),
    },
  });

  await assert.rejects(
    () => serviceService.deleteService({ role: 'dueno', tenantId: 't1' }, 's1'),
    (err) => err.status === 400
  );
});

test('deleteService permite desactivar cuando es la última service de la category pero no hay ningún room activo dependiendo', async () => {
  mockPrisma({
    service: {
      findUnique: async () => ({ id: 's1', tenantId: 't1', category: 'masajes' }),
      count: async () => 0,
      update: async (args) => ({ id: 's1', ...args.data }),
    },
    room: {
      findFirst: async () => null, // ningún room activo con specialty "masajes"
    },
  });

  const result = await serviceService.deleteService({ role: 'dueno', tenantId: 't1' }, 's1');
  assert.equal(result.active, false);
});
