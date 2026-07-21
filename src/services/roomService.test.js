const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const roomService = require('./roomService');

function mockPrisma({ service = {}, room = {} } = {}) {
  prisma.service = service;
  prisma.room = room;
  prisma.adminAuditLog = { create: async () => ({}) };
  prisma.$transaction = async (fn) => fn(prisma);
}

test('createRoom rechaza con 400 si specialty no coincide con ninguna categoría de servicio activa', async () => {
  mockPrisma({
    service: { findFirst: async () => null },
  });

  await assert.rejects(
    () => roomService.createRoom({ role: 'dueno', tenantId: 't1' }, { name: 'Gabinete 1', specialty: 'inexistente' }),
    (err) => err.status === 400
  );
});

test('createRoom crea el gabinete cuando specialty sí coincide con una categoría activa', async () => {
  mockPrisma({
    service: { findFirst: async () => ({ id: 'srv1', category: 'masajes', active: true }) },
    room: { create: async (args) => ({ id: 'room1', ...args.data }) },
  });

  const result = await roomService.createRoom(
    { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
    { name: 'Gabinete 1', specialty: 'masajes' }
  );
  assert.equal(result.specialty, 'masajes');
  assert.equal(result.status, 'libre');
});

test('createRoom ignora un tenantId forjado y usa el del JWT del actor', async () => {
  mockPrisma({
    service: { findFirst: async () => ({ id: 'srv1' }) },
    room: { create: async (args) => ({ id: 'room1', ...args.data }) },
  });

  const result = await roomService.createRoom(
    { role: 'dueno', tenantId: 'tenant-real', id: 'a1', email: 'a@test.com' },
    { name: 'Gabinete 1', specialty: 'masajes', tenantId: 'tenant-forjado' }
  );
  assert.equal(result.tenantId, 'tenant-real');
});

test('updateRoom valida de nuevo specialty si se cambia', async () => {
  mockPrisma({
    service: { findFirst: async () => null },
    room: { findUnique: async () => ({ id: 'room1', tenantId: 't1', specialty: 'masajes' }) },
  });

  await assert.rejects(
    () => roomService.updateRoom({ role: 'dueno', tenantId: 't1' }, 'room1', { specialty: 'categoria-que-no-existe' }),
    (err) => err.status === 400
  );
});
