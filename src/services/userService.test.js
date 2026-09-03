const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const userService = require('./userService');

function mockPrisma({ user = {}, rolePermission = {} } = {}) {
  prisma.user = user;
  prisma.rolePermission = rolePermission;
  prisma.adminAuditLog = { create: async () => ({}) };
  prisma.$transaction = async (fn) => fn(prisma);
}

test('updateUser rechaza con 403 si el usuario objetivo es isProtected', async () => {
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'u1', isProtected: true, tenantId: 't1' }),
    },
  });

  await assert.rejects(
    () => userService.updateUser({ role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' }, 'u1', { name: 'x' }),
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
    () => userService.deleteUser({ role: 'superadmin', tenantId: null, id: 'sa1', email: 'sa@test.com' }, 'u1'),
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
    () => userService.updateUser({ role: 'dueno', tenantId: 'tenant-propio', id: 'a1', email: 'a@test.com' }, 'u2', { name: 'x' }),
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

  const result = await userService.updateUser({ role: 'superadmin', tenantId: null, id: 'sa1', email: 'sa@test.com' }, 'u2', { name: 'Nuevo Nombre' });
  assert.equal(result.name, 'Nuevo Nombre');
});

test('updateUser de superadmin audita dentro del tenant de la cuenta afectada', async () => {
  let auditData = null;
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'u2', isProtected: false, tenantId: 'tenant-spa', active: true }),
      update: async (args) => ({ id: 'u2', ...args.data }),
    },
  });
  prisma.adminAuditLog.create = async ({ data }) => { auditData = data; return {}; };

  await userService.updateUser(
    { role: 'superadmin', tenantId: null, id: 'sa1', email: 'sa@test.com' },
    'u2',
    { active: false }
  );

  assert.equal(auditData.tenantId, 'tenant-spa');
  assert.equal(auditData.action, 'deactivate');
});

test('updateUser aplica cambios normalmente cuando no hay conflicto', async () => {
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'u3', isProtected: false, tenantId: 't1' }),
      update: async (args) => ({ id: 'u3', ...args.data }),
    },
  });

  const result = await userService.updateUser({ role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' }, 'u3', { active: false });
  assert.equal(result.active, false);
});

test('updateUser permite ajustar rol y disponibilidad de citas, creando permisos al volver a personal', async () => {
  let updateData = null;
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'u5', isProtected: false, tenantId: 't1', role: 'dueno' }),
      update: async (args) => {
        updateData = args.data;
        return { id: 'u5', ...args.data, rolePermission: null };
      },
      count: async () => 1,
    },
    rolePermission: {
      upsert: async () => ({ id: 'rp5', agenda: false }),
    },
  });

  const result = await userService.updateUser(
    { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
    'u5',
    { role: 'personal', canAttendAppointments: true }
  );

  assert.deepEqual(updateData, {
    role: 'personal',
    canAttendAppointments: true,
    sessionVersion: { increment: 1 },
  });
  assert.equal(result.role, 'personal');
  assert.equal(result.canAttendAppointments, true);
  assert.equal(result.rolePermission.id, 'rp5');
});

test('updateUser no permite cambiar el propio rol ni roles fuera de la lista', async () => {
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'a1', isProtected: false, tenantId: 't1', role: 'dueno' }),
    },
  });
  const actor = { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' };

  await assert.rejects(
    () => userService.updateUser(actor, 'a1', { role: 'personal' }),
    (err) => err.status === 400 && /propio rol/.test(err.message)
  );
  await assert.rejects(
    () => userService.updateUser(actor, 'a1', { role: 'superadmin' }),
    (err) => err.status === 400 && /Rol no permitido/.test(err.message)
  );
});

test('deleteUser rechaza que el superadmin se elimine a sí mismo', async () => {
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'sa1', isProtected: false, tenantId: 'tenant-spa' }),
    },
  });

  await assert.rejects(
    () => userService.deleteUser({ role: 'superadmin', tenantId: null, id: 'sa1', email: 'sa@test.com' }, 'sa1'),
    (err) => err.status === 400 && /propia cuenta/.test(err.message)
  );
});

test('deleteUser permite a la dueña eliminar otra cuenta no protegida de su tenant', async () => {
  let archived = null;
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'staff1', isProtected: false, tenantId: 't1', role: 'personal', active: true }),
      update: async (args) => { archived = args; return { id: args.where.id, ...args.data }; },
    },
  });

  const result = await userService.deleteUser(
    { role: 'dueno', tenantId: 't1', id: 'owner1', email: 'owner@test.com' },
    'staff1'
  );

  assert.equal(archived.where.id, 'staff1');
  assert.equal(archived.data.active, false);
  assert.equal(archived.data.deletedAt instanceof Date, true);
  assert.equal(archived.data.email, 'deleted-staff1@accounts.invalid');
  assert.deepEqual(archived.data.sessionVersion, { increment: 1 });
  assert.equal(result.id, 'staff1');
});

test('deleteUser no permite eliminar la única cuenta Dueña activa', async () => {
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'owner2', isProtected: false, tenantId: 't1', role: 'dueno', active: true }),
      count: async () => 0,
      update: async () => { throw new Error('no debe eliminar'); },
    },
  });

  await assert.rejects(
    () => userService.deleteUser(
      { role: 'superadmin', tenantId: null, id: 'tech1', email: 'tech@test.com' },
      'owner2'
    ),
    (err) => err.status === 400 && /única cuenta Dueña/.test(err.message)
  );
});

test('updatePermissions incrementa sessionVersion para cerrar la sesión afectada', async () => {
  let invalidation = null;
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'staff1', isProtected: false, tenantId: 't1', role: 'personal' }),
      update: async (args) => { invalidation = args.data; return {}; },
    },
    rolePermission: { upsert: async (args) => args.update },
  });

  await userService.updatePermissions(
    { role: 'dueno', tenantId: 't1', id: 'owner1', email: 'owner@test.com' },
    'staff1',
    { agenda: true }
  );

  assert.deepEqual(invalidation, { sessionVersion: { increment: 1 } });
});

test('createUser ignora por completo un tenantId forjado en el body y usa el del JWT del actor', async () => {
  mockPrisma({
    user: {
      create: async (args) => ({ id: 'nuevo', ...args.data }),
    },
  });

  const result = await userService.createUser(
    { role: 'dueno', tenantId: 'tenant-real-del-jwt', id: 'a1', email: 'a@test.com' },
    {
      email: 'valida@spa.test',
      password: 'Abcdefg123!',
      name: 'Test',
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
    { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
    { email: 'valida@spa.test', password: 'Abcdefg123!', name: 'X', role: 'personal' }
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

  const result = await userService.updateUser({ role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' }, 'u4', { password: 'nueva-clave' });
  assert.equal('passwordHash' in result, false);
});

test('createUser exige tenantId en el body cuando el actor es superadmin (sin tenant propio)', async () => {
  mockPrisma({ user: {} });

  await assert.rejects(() =>
    userService.createUser({ role: 'superadmin', tenantId: null, id: 'sa1', email: 'sa@test.com' }, {
      email: 'valida@spa.test',
      password: 'Abcdefg123!',
      name: 'X',
      role: 'dueno',
    }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /tenantId/);
      return true;
    }
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

  const result = await userService.listUsers({ role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' });
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

  await userService.listUsers({ role: 'superadmin', tenantId: null, id: 'sa1', email: 'sa@test.com' });
  assert.deepEqual(argsSeen.where, { deletedAt: null });
  assert.equal('passwordHash' in argsSeen.select, false);
  assert.equal(argsSeen.select.isProtected, true);
});

// ===========================================================================
// SECURITY TESTS: Role escalation, isProtected bypass, tenant isolation, input validation
// ===========================================================================

test('[SECURITY] createUser rechaza role "superadmin" con 400', async () => {
  mockPrisma({ user: { create: async () => ({}) } });
  await assert.rejects(
    () => userService.createUser(
      { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
      { email: 'hacker@evil.com', password: 'Abcdefg123!', name: 'Hacker', role: 'superadmin' }
    ),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Rol no permitido/);
      return true;
    }
  );
});

test('[SECURITY] createUser rechaza role "admin" (no existe en whitelist)', async () => {
  mockPrisma({ user: { create: async () => ({}) } });
  await assert.rejects(
    () => userService.createUser(
      { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
      { email: 'hacker@evil.com', password: 'Abcdefg123!', name: 'Hacker', role: 'admin' }
    ),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /Rol no permitido/);
      return true;
    }
  );
});

test('[SECURITY] createUser rechaza role undefined/null/empty', async () => {
  mockPrisma({ user: { create: async () => ({}) } });
  for (const badRole of [undefined, null, '', 'root', 'god']) {
    await assert.rejects(
      () => userService.createUser(
        { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
        { email: 'test@spa.test', password: 'Abcdefg123!', name: 'Test', role: badRole }
      ),
      (err) => {
        assert.equal(err.status, 400, `role="${badRole}" deberia ser rechazado con 400`);
        return true;
      }
    );
  }
});

test('[SECURITY] createUser con isProtected: true en body lo ignora (siempre false)', async () => {
  let capturedData;
  mockPrisma({
    user: {
      count: async () => 0,
      create: async (args) => { capturedData = args.data; return { id: 'u1', ...args.data }; },
    },
  });

  await userService.createUser(
    { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
    { email: 'nueva@spa.test', password: 'Abcdefg123!', name: 'Test', role: 'dueno', isProtected: true }
  );

  assert.equal(capturedData.isProtected, false, 'isProtected debe ser hardcodeado a false');
});

test('createUser impide crear una segunda cuenta Dueña activa', async () => {
  mockPrisma({
    user: {
      count: async () => 1,
      create: async () => { throw new Error('no debe crear'); },
    },
  });

  await assert.rejects(
    () => userService.createUser(
      { role: 'dueno', tenantId: 't1', id: 'owner1', email: 'owner@test.com' },
      { email: 'otra@spa.test', password: 'Abcdefg123!', name: 'Otra dueña', role: 'dueno' }
    ),
    (err) => err.status === 400 && /ya tiene una cuenta Dueña activa/.test(err.message)
  );
});

test('updateUser impide promover personal si ya existe una Dueña activa', async () => {
  mockPrisma({
    user: {
      findUnique: async () => ({ id: 'staff1', isProtected: false, tenantId: 't1', role: 'personal', active: true }),
      count: async () => 1,
      update: async () => { throw new Error('no debe promover'); },
    },
  });

  await assert.rejects(
    () => userService.updateUser(
      { role: 'dueno', tenantId: 't1', id: 'owner1', email: 'owner@test.com' },
      'staff1',
      { role: 'dueno' }
    ),
    (err) => err.status === 400 && /ya tiene una cuenta Dueña activa/.test(err.message)
  );
});

test('[SECURITY] actor de tenant A no puede crear usuario en tenant B', async () => {
  let capturedData;
  mockPrisma({
    user: {
      create: async (args) => { capturedData = args.data; return { id: 'u1', ...args.data }; },
    },
  });

  await userService.createUser(
    { role: 'dueno', tenantId: 'tenant-a', id: 'a1', email: 'a@test.com' },
    { email: 'nueva@spa.test', password: 'Abcdefg123!', name: 'Test', role: 'personal', tenantId: 'tenant-b' }
  );

  assert.equal(capturedData.tenantId, 'tenant-a', 'Debe usar tenant del JWT, no el del body');
});

test('[SECURITY] password menor a 8 caracteres es rechazado con 400', async () => {
  mockPrisma({ user: { create: async () => ({}) } });
  await assert.rejects(
    () => userService.createUser(
      { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
      { email: 'test@spa.test', password: '12345', name: 'Test', role: 'personal' }
    ),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /contraseña/i);
      return true;
    }
  );
});

test('[SECURITY] password de exactamente 8 caracteres es aceptado', async () => {
  let capturedData;
  mockPrisma({
    user: {
      create: async (args) => { capturedData = args.data; return { id: 'u8', ...args.data, rolePermission: { id: 'rp8' } }; },
    },
  });

  const result = await userService.createUser(
    { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
    { email: 'ocho@spa.test', password: '12345678', name: 'Ocho', role: 'personal' }
  );

  assert.equal(userService.MIN_PASSWORD_LENGTH, 8);
  assert.ok(capturedData.passwordHash);
  assert.equal(result.id, 'u8');
  assert.equal('passwordHash' in result, false);
});

test('[SECURITY] email sin formato valido es rechazado con 400', async () => {
  mockPrisma({ user: { create: async () => ({}) } });
  await assert.rejects(
    () => userService.createUser(
      { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
      { email: 'no-tiene-arroba', password: 'Abcdefg123!', name: 'Test', role: 'personal' }
    ),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /[Ee]mail/);
      return true;
    }
  );
});

test('[SECURITY] nombre vacio o solo espacios es rechazado con 400', async () => {
  mockPrisma({ user: { create: async () => ({}) } });
  await assert.rejects(
    () => userService.createUser(
      { role: 'dueno', tenantId: 't1', id: 'a1', email: 'a@test.com' },
      { email: 'test@spa.test', password: 'Abcdefg123!', name: '   ', role: 'personal' }
    ),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /nombre/i);
      return true;
    }
  );
});

test('[SECURITY] happy path: crear personal valido funciona correctamente', async () => {
  let capturedData;
  mockPrisma({
    user: {
      create: async (args) => { capturedData = args.data; return { id: 'u-nuevo', ...args.data, rolePermission: { id: 'rp1' } }; },
    },
  });

  const result = await userService.createUser(
    { role: 'dueno', tenantId: 'tenant-spa', id: 'a1', email: 'a@test.com' },
    {
      email: 'nueva.terapeuta@almaspa.test',
      password: 'SecurePass123',
      name: 'Maria Lopez',
      role: 'personal',
      canAttendAppointments: true,
      permissions: { agenda: true, gabinetes: false, clientes: true, crm: false, reportes: false, configuracion: false },
    }
  );

  assert.equal(capturedData.role, 'personal');
  assert.equal(capturedData.tenantId, 'tenant-spa');
  assert.equal(capturedData.isProtected, false);
  assert.equal(capturedData.canAttendAppointments, true);
  assert.ok(capturedData.passwordHash, 'Debe tener hash de password');
  assert.ok(!result.passwordHash, 'Respuesta no debe exponer passwordHash');
  assert.equal(result.id, 'u-nuevo');
});

test('[SECURITY] ALLOWED_ROLES_FOR_CREATION solo contiene personal y dueno', () => {
  assert.deepEqual(
    [...userService.ALLOWED_ROLES_FOR_CREATION].sort(),
    ['dueno', 'personal']
  );
});

test('permisos finos de bandeja se normalizan y no se activan por accidente', () => {
  const permissions = userService.normalizePermissions({
    crm: true,
    crmEtiquetasGestionar: true,
    crmNotasGestionar: true,
  });

  assert.equal(permissions.crm, true);
  assert.equal(permissions.crmEtiquetasGestionar, true);
  assert.equal(permissions.crmNotasGestionar, true);
  assert.equal(permissions.crmRespuestasRapidasGestionar, false);
});
