const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');

const userService = require('./userService');
const serviceService = require('./serviceService');
const roomService = require('./roomService');
const categoryService = require('./categoryService');

let auditRows = [];

function mockPrismaWith(overrides) {
  auditRows = [];
  prisma.adminAuditLog = {
    create: async (args) => {
      auditRows.push(args.data);
      return { id: 'audit1', ...args.data };
    },
  };
  prisma.$transaction = async (fn) => fn(prisma);
  Object.assign(prisma, overrides);
}

const actor = { id: 'actor1', email: 'admin@almaspa.test', role: 'dueno', tenantId: 't1' };

// ═══════════════════════════════════════════════════════════════
// Self-deactivation block
// ═══════════════════════════════════════════════════════════════

test('updateUser rejects self-deactivation with 400', async () => {
  mockPrismaWith({
    user: {
      findUnique: async () => ({ id: 'actor1', isProtected: false, tenantId: 't1', active: true }),
      update: async (args) => ({ id: 'actor1', ...args.data }),
    },
  });

  await assert.rejects(
    () => userService.updateUser(actor, 'actor1', { active: false }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /propia cuenta/);
      return true;
    }
  );
  assert.equal(auditRows.length, 0, 'Rejected action must NOT write audit log');
});

test('updateUser allows deactivating another user', async () => {
  mockPrismaWith({
    user: {
      findUnique: async () => ({ id: 'other1', isProtected: false, tenantId: 't1', active: true }),
      update: async (args) => ({ id: 'other1', ...args.data }),
    },
  });

  const result = await userService.updateUser(actor, 'other1', { active: false });
  assert.equal(result.active, false);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, 'deactivate');
});

// ═══════════════════════════════════════════════════════════════
// isProtected guard — audit log must NOT be written
// ═══════════════════════════════════════════════════════════════

test('updateUser on isProtected user throws 403 and writes no audit', async () => {
  mockPrismaWith({
    user: {
      findUnique: async () => ({ id: 'root', isProtected: true, tenantId: 't1' }),
    },
  });

  await assert.rejects(
    () => userService.updateUser(actor, 'root', { name: 'Hacked' }),
    (err) => err.status === 403
  );
  assert.equal(auditRows.length, 0);
});

test('deleteUser on isProtected user throws 403 and writes no audit', async () => {
  mockPrismaWith({
    user: {
      findUnique: async () => ({ id: 'root', isProtected: true, tenantId: null }),
    },
  });

  await assert.rejects(
    () => userService.deleteUser({ ...actor, role: 'superadmin', tenantId: null }, 'root'),
    (err) => err.status === 403
  );
  assert.equal(auditRows.length, 0);
});

// ═══════════════════════════════════════════════════════════════
// Cascade guard via toggle (unified path)
// ═══════════════════════════════════════════════════════════════

test('deactivating last service of category via updateService triggers cascade guard', async () => {
  mockPrismaWith({
    service: {
      findUnique: async () => ({ id: 's1', tenantId: 't1', category: 'masajes', active: true }),
      count: async () => 0,
    },
    room: {
      findFirst: async () => ({ id: 'room1', name: 'Sala masajes', specialty: 'masajes', active: true }),
    },
  });

  await assert.rejects(
    () => serviceService.updateService(actor, 's1', { active: false }),
    (err) => err.status === 400
  );
  assert.equal(auditRows.length, 0, 'Cascade rejection must NOT write audit log');
});

test('deactivating last service of category via deleteService (wrapper) triggers same cascade guard', async () => {
  mockPrismaWith({
    service: {
      findUnique: async () => ({ id: 's1', tenantId: 't1', category: 'masajes', active: true }),
      count: async () => 0,
    },
    room: {
      findFirst: async () => ({ id: 'room1', name: 'Sala masajes', specialty: 'masajes', active: true }),
    },
  });

  await assert.rejects(
    () => serviceService.deleteService(actor, 's1'),
    (err) => err.status === 400
  );
  assert.equal(auditRows.length, 0);
});

// ═══════════════════════════════════════════════════════════════
// Audit log writes for each entity type
// ═══════════════════════════════════════════════════════════════

test('createUser writes audit log with action=create', async () => {
  mockPrismaWith({
    user: {
      create: async (args) => ({ id: 'u-new', ...args.data, rolePermission: null }),
    },
  });

  await userService.createUser(actor, {
    email: 'new@spa.test',
    password: 'SecurePass123',
    name: 'New User',
    role: 'personal',
  });

  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].entity, 'user');
  assert.equal(auditRows[0].action, 'create');
  assert.equal(auditRows[0].actorId, 'actor1');
  assert.equal(auditRows[0].actorEmail, 'admin@almaspa.test');
});

test('updateUser writes audit log — never includes passwordHash in detail', async () => {
  mockPrismaWith({
    user: {
      findUnique: async () => ({ id: 'u2', isProtected: false, tenantId: 't1', active: true }),
      update: async (args) => ({ id: 'u2', ...args.data }),
    },
  });

  await userService.updateUser(actor, 'u2', { password: 'NewSecure123' });

  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, 'update');
  assert.ok(!auditRows[0].detail?.passwordHash, 'passwordHash must NEVER appear in audit detail');
  assert.ok(!auditRows[0].detail?.password, 'password must NEVER appear in audit detail');
});

test('deleteUser writes audit log with action=purge', async () => {
  mockPrismaWith({
    user: {
      findUnique: async () => ({ id: 'u3', isProtected: false, tenantId: 't1', name: 'Deleted User', email: 'd@test.com', active: true }),
      delete: async () => ({ id: 'u3' }),
    },
  });

  await userService.deleteUser(actor, 'u3');

  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, 'purge');
  assert.equal(auditRows[0].entity, 'user');
});

test('updatePermissions writes audit log with action=permissionsChanged', async () => {
  mockPrismaWith({
    user: {
      findUnique: async () => ({ id: 'u4', isProtected: false, tenantId: 't1', role: 'personal' }),
    },
    rolePermission: {
      upsert: async (args) => ({ id: 'rp1', userId: 'u4', ...args.update }),
    },
  });

  await userService.updatePermissions(actor, 'u4', { agenda: true, reportes: false });

  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, 'permissionsChanged');
});

test('createService writes audit log with action=create', async () => {
  mockPrismaWith({
    service: {
      create: async (args) => ({ id: 's-new', ...args.data }),
    },
  });

  await serviceService.createService(actor, { name: 'Masaje', category: 'masajes', priceUsd: 50 });

  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].entity, 'service');
  assert.equal(auditRows[0].action, 'create');
});

test('updateService deactivate writes audit log with action=deactivate', async () => {
  mockPrismaWith({
    service: {
      findUnique: async () => ({ id: 's1', tenantId: 't1', category: 'masajes', active: true }),
      count: async () => 1,
      update: async (args) => ({ id: 's1', ...args.data }),
    },
  });

  await serviceService.updateService(actor, 's1', { active: false });

  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, 'deactivate');
});

test('createRoom writes audit log with action=create', async () => {
  mockPrismaWith({
    service: {
      findFirst: async () => ({ id: 'srv1' }),
    },
    room: {
      create: async (args) => ({ id: 'r-new', ...args.data }),
    },
  });

  await roomService.createRoom(actor, { name: 'Gabinete 1', specialty: 'masajes' });

  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].entity, 'room');
  assert.equal(auditRows[0].action, 'create');
});

test('updateRoom activate writes audit log with action=activate', async () => {
  mockPrismaWith({
    room: {
      findUnique: async () => ({ id: 'r1', tenantId: 't1', active: false }),
      update: async (args) => ({ id: 'r1', ...args.data }),
    },
  });

  await roomService.updateRoom(actor, 'r1', { active: true });

  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, 'activate');
});

test('deleteCategory writes audit log with action=deactivate', async () => {
  mockPrismaWith({
    serviceCategory: {
      findUnique: async () => ({ id: 'cat1', tenantId: 't1', name: 'Facial', active: true }),
      update: async (args) => ({ id: 'cat1', name: 'Facial', ...args.data }),
    },
    room: { findFirst: async () => null },
    service: { findFirst: async () => null },
  });

  await categoryService.deleteCategory(actor, 'cat1');

  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].entity, 'category');
  assert.equal(auditRows[0].action, 'deactivate');
});

// ═══════════════════════════════════════════════════════════════
// Tenant isolation in audit log
// ═══════════════════════════════════════════════════════════════

test('audit log tenantId always comes from actor, not from data', async () => {
  mockPrismaWith({
    service: {
      create: async (args) => ({ id: 's-new', ...args.data }),
    },
  });

  await serviceService.createService(
    { ...actor, tenantId: 'real-tenant' },
    { name: 'Test', category: 'test', priceUsd: 10, tenantId: 'forged-tenant' }
  );

  assert.equal(auditRows[0].tenantId, 'real-tenant');
});
