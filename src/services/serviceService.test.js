const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const serviceService = require('./serviceService');

function mockPrisma({ service = {}, room = {} } = {}) {
  prisma.service = service;
  prisma.room = room;
  prisma.adminAuditLog = { create: async () => ({}) };
  prisma.$transaction = async (fn) => fn(prisma);
}

test('createService ignora un tenantId forjado en el body y usa el del JWT del actor', async () => {
  mockPrisma({ service: { create: async (args) => ({ id: 'nuevo', ...args.data }) } });

  const result = await serviceService.createService(
    { role: 'dueno', tenantId: 'tenant-real-del-jwt', id: 'a1', email: 'a@test.com' },
    { name: 'Masaje relajante', category: 'masajes', priceUsd: 45, tenantId: 'tenant-forjado' }
  );

  assert.equal(result.tenantId, 'tenant-real-del-jwt');
});

test('createService acepta duración variable válida y conserva buffer de 15 minutos por defecto', async () => {
  mockPrisma({ service: { create: async (args) => ({ id: 'nuevo', ...args.data }) } });

  const result = await serviceService.createService(
    { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
    { name: 'Facial', category: 'faciales', priceUsd: 30, durationMins: 45 }
  );

  assert.equal(result.durationMins, 45);
  assert.equal(result.bufferMins, 15);
});

test('createService rechaza duraciones fuera del rango permitido', async () => {
  mockPrisma({ service: { create: async (args) => ({ id: 'nuevo', ...args.data }) } });

  await assert.rejects(
    () => serviceService.createService(
      { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
      { name: 'Facial', category: 'faciales', priceUsd: 30, durationMins: 999 }
    ),
    (err) => err.status === 400 && /durationMins/.test(err.message)
  );
});

test('createService guarda offersHomeService del body (bug real encontrado en verificación de Fase 3a: no se leía)', async () => {
  mockPrisma({ service: { create: async (args) => ({ id: 'nuevo', ...args.data }) } });

  const result = await serviceService.createService(
    { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
    { name: 'Masaje relajante', category: 'masajes', priceUsd: 45, offersHomeService: true }
  );

  assert.equal(result.offersHomeService, false);
});

test('createService por defecto offersHomeService=false si no se manda', async () => {
  mockPrisma({ service: { create: async (args) => ({ id: 'nuevo', ...args.data }) } });

  const result = await serviceService.createService(
    { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
    { name: 'Limpieza facial', category: 'faciales', priceUsd: 30 }
  );

  assert.equal(result.offersHomeService, false);
});

test('createService guarda description recortada', async () => {
  mockPrisma({ service: { create: async (args) => ({ id: 'nuevo', ...args.data }) } });

  const result = await serviceService.createService(
    { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
    { name: 'Facial', category: 'faciales', priceUsd: 30, description: '  Limpieza profunda con extracción y mascarilla.  ' }
  );

  assert.equal(result.description, 'Limpieza profunda con extracción y mascarilla.');
});

test('createService rechaza description de más de 500 caracteres', async () => {
  mockPrisma({ service: { create: async (args) => ({ id: 'nuevo', ...args.data }) } });

  await assert.rejects(
    () => serviceService.createService(
      { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
      { name: 'Facial', category: 'faciales', priceUsd: 30, description: 'x'.repeat(501) }
    ),
    (err) => err.status === 400 && /description/.test(err.message)
  );
});

test('createService acepta una imagen JPEG válida (detectada por magic bytes) y la guarda como Buffer', async () => {
  let captured = null;
  mockPrisma({ service: { create: async (args) => { captured = args.data; return { id: 'nuevo', ...args.data }; } } });
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');

  await serviceService.createService(
    { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
    { name: 'Facial', category: 'faciales', priceUsd: 30, image: `data:image/jpeg;base64,${jpegBytes}` }
  );

  assert.equal(Buffer.isBuffer(captured.imageData), true);
  assert.equal(captured.imageMimeType, 'image/jpeg');
  assert.equal(captured.imageUpdatedAt instanceof Date, true);
});

test('createService rechaza un archivo que no es JPEG/PNG aunque el data URL diga que sí', async () => {
  mockPrisma({ service: { create: async (args) => ({ id: 'nuevo', ...args.data }) } });
  const fakeBytes = Buffer.from('esto no es una imagen real').toString('base64');

  await assert.rejects(
    () => serviceService.createService(
      { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
      { name: 'Facial', category: 'faciales', priceUsd: 30, image: `data:image/jpeg;base64,${fakeBytes}` }
    ),
    (err) => err.status === 400 && /JPEG o PNG/.test(err.message)
  );
});

test('createService rechaza una imagen que supera el límite de 300KB', async () => {
  mockPrisma({ service: { create: async (args) => ({ id: 'nuevo', ...args.data }) } });
  const bigBuffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(310 * 1024, 0)]);
  const dataUrl = `data:image/jpeg;base64,${bigBuffer.toString('base64')}`;

  await assert.rejects(
    () => serviceService.createService(
      { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
      { name: 'Facial', category: 'faciales', priceUsd: 30, image: dataUrl }
    ),
    (err) => err.status === 400 && /máximo permitido/.test(err.message)
  );
});

test('updateService con image:null borra la imagen existente', async () => {
  mockPrisma({
    service: {
      findUnique: async () => ({ id: 's1', tenantId: 't1', category: 'masajes', active: true, imageData: Buffer.from([1]), imageMimeType: 'image/jpeg' }),
      update: async (args) => ({ id: 's1', ...args.data }),
    },
  });

  const result = await serviceService.updateService({ role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' }, 's1', { image: null });
  assert.equal(result.imageData, null);
  assert.equal(result.imageMimeType, null);
  assert.equal(result.imageUpdatedAt, null);
});

test('getServiceImage devuelve { image: null } cuando el servicio no tiene imagen', async () => {
  mockPrisma({ service: { findUnique: async () => ({ tenantId: 't1', imageData: null, imageMimeType: null, imageUpdatedAt: null }) } });

  const result = await serviceService.getServiceImage({ role: 'dueno', tenantId: 't1' }, 's1');
  assert.deepEqual(result, { image: null });
});

test('getServiceImage rechaza con 403 cross-tenant', async () => {
  mockPrisma({ service: { findUnique: async () => ({ tenantId: 'tenant-otro', imageData: Buffer.from([1]), imageMimeType: 'image/jpeg' }) } });

  await assert.rejects(
    () => serviceService.getServiceImage({ role: 'dueno', tenantId: 'tenant-propio' }, 's1'),
    (err) => err.status === 403
  );
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
      findUnique: async () => ({ id: 's1', tenantId: 't1', category: 'masajes', active: true }),
      count: async () => 1,
      update: async (args) => ({ id: 's1', ...args.data }),
    },
  });

  const result = await serviceService.deleteService({ role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' }, 's1');
  assert.equal(result.active, false);
});

test('deleteService rechaza con 400 si es la última service activa de la category y un room activo depende de ella', async () => {
  mockPrisma({
    service: {
      findUnique: async () => ({ id: 's1', tenantId: 't1', category: 'masajes', active: true }),
      count: async () => 0,
    },
    room: {
      findFirst: async () => ({ id: 'room1', name: 'Sala de masajes', specialty: 'masajes', active: true }),
    },
  });

  await assert.rejects(
    () => serviceService.deleteService({ role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' }, 's1'),
    (err) => err.status === 400
  );
});

test('deleteService permite desactivar cuando es la última service de la category pero no hay ningún room activo dependiendo', async () => {
  mockPrisma({
    service: {
      findUnique: async () => ({ id: 's1', tenantId: 't1', category: 'masajes', active: true }),
      count: async () => 0,
      update: async (args) => ({ id: 's1', ...args.data }),
    },
    room: {
      findFirst: async () => null,
    },
  });

  const result = await serviceService.deleteService({ role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' }, 's1');
  assert.equal(result.active, false);
});
