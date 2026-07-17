const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const userService = require('./userService');

function mockPrisma({ user = {}, rolePermission = {} } = {}) {
  prisma.user = user;
  prisma.rolePermission = rolePermission;
}

test('updateUser rechaza con 403 si el usuario objetivo es isProtected', async () => {
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'u1', isProtected: true, tenantId: 't1' }),
    },
  });

  await assert.rejects(
    () => userService.updateUser({ role: 'dueno', tenantId: 't1' }, 'u1', { name: 'x' }),
    (err) => err instanceof userService.ProtectedAccountError && err.status === 403
  );
});

test('deleteUser rechaza con 403 si el usuario objetivo es isProtected, incluso siendo superadmin', async () => {
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'u1', isProtected: true, tenantId: null }),
    },
  });

  await assert.rejects(
    () => userService.deleteUser({ role: 'superadmin', tenantId: null }, 'u1'),
    (err) => err instanceof userService.ProtectedAccountError
  );
});

test('updateUser rechaza con 403 si el actor (dueno) intenta tocar un usuario de otro tenant', async () => {
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'u2', isProtected: false, tenantId: 'tenant-otro' }),
      update: async () => ({ id: 'u2' }),
    },
  });

  await assert.rejects(
    () => userService.updateUser({ role: 'dueno', tenantId: 'tenant-propio' }, 'u2', { name: 'x' }),
    (err) => err instanceof userService.ForbiddenTenantError
  );
});

test('updateUser permite a superadmin (sin tenant) operar sobre cualquier tenant', async () => {
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'u2', isProtected: false, tenantId: 'tenant-cualquiera' }),
      update: async (args) => ({ id: 'u2', ...args.data }),
    },
  });

  const result = await userService.updateUser({ role: 'superadmin', tenantId: null }, 'u2', { name: 'Nuevo Nombre' });
  assert.equal(result.name, 'Nuevo Nombre');
});

test('updateUser aplica cambios normalmente cuando no hay conflicto', async () => {
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'u3', isProtected: false, tenantId: 't1' }),
      update: async (args) => ({ id: 'u3', ...args.data }),
    },
  });

  const result = await userService.updateUser({ role: 'dueno', tenantId: 't1' }, 'u3', { active: false });
  assert.equal(result.active, false);
});

test('createUser ignora por completo un tenantId forjado en el body y usa el del JWT del actor', async () => {
  mockPrisma({
    user: {
      create: async (args) => ({ id: 'nuevo', ...args.data }),
    },
  });

  const result = await userService.createUser(
    { role: 'dueno', tenantId: 'tenant-real-del-jwt' },
    {
      email: 'x@x.com',
      password: 'x',
      name: 'X',
      role: 'personal',
      tenantId: 'tenant-forjado-por-el-cliente',
    }
  );

  assert.equal(result.tenantId, 'tenant-real-del-jwt');
});

test('createUser nunca devuelve passwordHash en el objeto resultante', async () => {
  mockPrisma({
    user: {
      create: async (args) => ({ id: 'nuevo', passwordHash: 'hash-secreto', ...args.data }),
    },
  });

  const result = await userService.createUser(
    { role: 'dueno', tenantId: 't1' },
    { email: 'x@x.com', password: 'x', name: 'X', role: 'personal' }
  );

  assert.equal('passwordHash' in result, false);
});

test('updateUser nunca devuelve passwordHash en el objeto resultante', async () => {
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'u4', isProtected: false, tenantId: 't1' }),
      update: async (args) => ({ id: 'u4', passwordHash: 'hash-secreto', ...args.data }),
    },
  });

  const result = await userService.updateUser({ role: 'dueno', tenantId: 't1' }, 'u4', { password: 'nueva-clave' });
  assert.equal('passwordHash' in result, false);
});

test('createUser exige tenantId en el body cuando el actor es superadmin (sin tenant propio)', async () => {
  mockPrisma({ user: {} });

  await assert.rejects(() =>
    userService.createUser({ role: 'superadmin', tenantId: null }, {
      email: 'x@x.com',
      password: 'x',
      name: 'X',
      role: 'dueno',
    })
  );
});


test('listUsers filtra por tenant del actor y usa select seguro sin passwordHash', async () => {
  let argsSeen = null;
  mockPrisma({
    user: {
      findMany: async (args) => {
        argsSeen = args;
        return [{ id: 'u1', tenantId: 't1', email: 'm@alma.test', name: 'Mariana', role: 'dueno', isProtected: false }];
      },
    },
  });

  const result = await userService.listUsers({ role: 'dueno', tenantId: 't1' });
  assert.equal(argsSeen.where.tenantId, 't1');
  assert.equal(argsSeen.select.email, true);
  assert.equal('passwordHash' in argsSeen.select, false);
  assert.equal(result[0].email, 'm@alma.test');
});

test('listUsers permite a superadmin consultar todos sin exponer passwordHash', async () => {
  let argsSeen = null;
  mockPrisma({
    user: {
      findMany: async (args) => { argsSeen = args; return []; },
    },
  });

  await userService.listUsers({ role: 'superadmin', tenantId: null });
  assert.deepEqual(argsSeen.where, {});
  assert.equal('passwordHash' in argsSeen.select, false);
  assert.equal(argsSeen.select.isProtected, true);
});
