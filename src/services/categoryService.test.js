const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const categoryService = require('./categoryService');

function mockPrisma({ serviceCategory = {}, room = {}, service = {} } = {}) {
  prisma.serviceCategory = serviceCategory;
  prisma.room = room;
  prisma.service = service;
  prisma.adminAuditLog = { create: async () => ({}) };
  prisma.$transaction = async (fn) => fn(prisma);
}

// --- deleteCategory cascade protection ---

test('deleteCategory devuelve 409 si un gabinete activo usa esta categoría como specialty', async () => {
  mockPrisma({
    serviceCategory: {
      findUnique: async () => ({ id: 'cat1', tenantId: 't1', name: 'Facial', active: true }),
    },
    room: {
      findFirst: async () => ({ id: 'room1', name: 'Gabinete 1', specialty: 'Facial', active: true }),
    },
    service: {
      findFirst: async () => null,
    },
  });

  await assert.rejects(
    () => categoryService.deleteCategory({ role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' }, 'cat1'),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /gabinetes activos/);
      return true;
    }
  );
});

test('deleteCategory devuelve 409 si hay servicios activos con esta categoría', async () => {
  mockPrisma({
    serviceCategory: {
      findUnique: async () => ({ id: 'cat1', tenantId: 't1', name: 'Facial', active: true }),
    },
    room: {
      findFirst: async () => null,
    },
    service: {
      findFirst: async () => ({ id: 'srv1', name: 'Limpieza facial', category: 'Facial', active: true }),
    },
  });

  await assert.rejects(
    () => categoryService.deleteCategory({ role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' }, 'cat1'),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /servicios activos/);
      return true;
    }
  );
});

test('deleteCategory permite soft-delete cuando no hay gabinetes ni servicios activos dependientes', async () => {
  mockPrisma({
    serviceCategory: {
      findUnique: async () => ({ id: 'cat1', tenantId: 't1', name: 'Facial', active: true }),
      update: async (args) => ({ id: 'cat1', name: 'Facial', ...args.data }),
    },
    room: {
      findFirst: async () => null,
    },
    service: {
      findFirst: async () => null,
    },
  });

  const result = await categoryService.deleteCategory({ role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' }, 'cat1');
  assert.equal(result.active, false);
});

test('deleteCategory devuelve null si la categoría no existe', async () => {
  mockPrisma({
    serviceCategory: {
      findUnique: async () => null,
    },
  });

  const result = await categoryService.deleteCategory({ role: 'dueno', tenantId: 't1' }, 'cat-inexistente');
  assert.equal(result, null);
});

test('deleteCategory rechaza con 403 si el actor pertenece a otro tenant', async () => {
  mockPrisma({
    serviceCategory: {
      findUnique: async () => ({ id: 'cat1', tenantId: 'tenant-otro', name: 'Facial', active: true }),
    },
  });

  await assert.rejects(
    () => categoryService.deleteCategory({ role: 'dueno', tenantId: 'tenant-propio' }, 'cat1'),
    (err) => err.status === 403
  );
});

// --- createCategory ---

test('createCategory rechaza con 400 si name está vacío', async () => {
  await assert.rejects(
    () => categoryService.createCategory({ role: 'dueno', tenantId: 't1' }, { name: '   ' }),
    (err) => err.status === 400
  );
});

test('createCategory crea la categoría correctamente', async () => {
  mockPrisma({
    serviceCategory: {
      create: async (args) => ({ id: 'new1', ...args.data }),
    },
  });

  const result = await categoryService.createCategory(
    { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
    { name: 'Corporal' }
  );
  assert.equal(result.name, 'Corporal');
  assert.equal(result.tenantId, 't1');
  assert.equal(result.active, true);
});
