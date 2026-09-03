const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const supertest = require('supertest');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'a]G4k!mR#9sXw2Lp@vN7jQ6dY1bT0cFe';
process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const { signToken } = require('../utils/jwt');
const app = require('../app');

function token(payload = {}) {
  return signToken({ id: 'u1', tenantId: 't1', role: 'personal', ...payload });
}

// El middleware accessSchedule (post-authenticate) hace su propio
// prisma.user.findUnique({ select: { accessSchedule, active } }) en cada
// request autenticada, sea cual sea el rol. Sin este mock, cae en la
// instancia real de Prisma y el usuario de prueba no existe en la base →
// 401 "Sesión inválida o cuenta inactiva" antes de llegar a la ruta.
function mockAccessScheduleUser(role = 'personal') {
  prisma.user = { findUnique: async () => ({
    id: 'u1', tenantId: 't1', role, email: 'u1@test.com',
    active: true, sessionVersion: 0, accessSchedule: null,
  }) };
}

test('GET /clients exige permiso clientes', async () => {
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: false }) };
  const res = await supertest(app).get('/clients').set('Authorization', `Bearer ${token()}`);
  assert.equal(res.status, 403);
});

test('GET /clients devuelve datos base sin ClientIntake aunque el cliente tenga ficha', async () => {
  let argsSeen = null;
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: true }) };
  prisma.client = {
    findMany: async (args) => {
      argsSeen = args;
      return [{
        id: 'c1', tenantId: 't1', fullName: 'Camila Andrade', whatsapp: '+593995128834', email: null,
        active: true, createdAt: new Date('2026-03-01'), updatedAt: new Date('2026-03-01'),
        intake: { allergies: 'no debe salir' },
      }];
    },
  };

  const res = await supertest(app).get('/clients?q=Camila').set('Authorization', `Bearer ${token()}`);
  assert.equal(res.status, 200);
  assert.equal(argsSeen.where.tenantId, 't1');
  assert.equal('intake' in argsSeen.select, false);
  assert.equal(res.body[0].fullName, 'Camila Andrade');
  assert.equal('intake' in res.body[0], false);
});

test('GET /clients/export exige permiso extra reportes o configuracion y no exporta ClientIntake', async () => {
  let argsSeen = null;
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: true, reportes: true, configuracion: false }) };
  prisma.client = {
    findMany: async (args) => {
      argsSeen = args;
      return [{
        id: 'c1',
        tenantId: 't1',
        recordNumber: '0077',
        fullName: 'Camila Andrade',
        whatsapp: '+593993629256',
        email: 'camila@test.com',
        address: 'Quito',
        birthday: new Date('1997-08-01T00:00:00Z'),
        active: true,
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        intake: { allergies: 'no debe exportarse' },
      }];
    },
  };

  const res = await supertest(app).get('/clients/export').set('Authorization', `Bearer ${token()}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.equal(argsSeen.where.tenantId, 't1');
  assert.equal('intake' in argsSeen.select, false);
  assert.match(res.text, /"Ficha","Nombre","WhatsApp"/);
  assert.match(res.text, /"0077","Camila Andrade","\+593993629256"/);
  assert.equal(res.text.includes('no debe exportarse'), false);
});

test('GET /clients/export niega a personal con clientes pero sin reportes/configuracion', async () => {
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: true, clientesExportar: false, reportes: false, configuracion: false }) };
  prisma.client = { findMany: async () => [] };

  const res = await supertest(app).get('/clients/export').set('Authorization', `Bearer ${token()}`);
  assert.equal(res.status, 403);
});

test('GET /clients/export permite permiso fino clientesExportar sin reportes/configuracion', async () => {
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: true, clientesExportar: true, reportes: false, configuracion: false }) };
  prisma.client = { findMany: async () => [] };

  const res = await supertest(app).get('/clients/export').set('Authorization', `Bearer ${token()}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
});

test('PATCH /clients/:id exige permiso fino clientesEditar', async () => {
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: true, clientesEditar: false }) };
  const res = await supertest(app)
    .patch('/clients/c1')
    .set('Authorization', `Bearer ${token()}`)
    .send({ fullName: 'Camila' });
  assert.equal(res.status, 403);
});

test('PUT /clients/:id/intake exige permiso fino clientesAnamnesis', async () => {
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: true, clientesAnamnesis: false }) };
  const res = await supertest(app)
    .put('/clients/c1/intake')
    .set('Authorization', `Bearer ${token()}`)
    .send({ allergies: 'Ninguna' });
  assert.equal(res.status, 403);
});

test('PATCH /clients/:id/disable exige permiso fino clientesEstado', async () => {
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: true, clientesEstado: false }) };
  const res = await supertest(app)
    .patch('/clients/c1/disable')
    .set('Authorization', `Bearer ${token()}`);
  assert.equal(res.status, 403);
});

test('DELETE /clients/:id exige permiso fino clientesEliminar', async () => {
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: true, clientesEliminar: false }) };
  const res = await supertest(app)
    .delete('/clients/c1')
    .set('Authorization', `Bearer ${token()}`);
  assert.equal(res.status, 403);
});

test('POST /clients/:id/treatments exige permiso fino clientesHistorial', async () => {
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: true, clientesHistorial: false }) };
  const res = await supertest(app)
    .post('/clients/c1/treatments')
    .set('Authorization', `Bearer ${token()}`)
    .send({ serviceId: 's1', sessionDate: '2026-08-17' });
  assert.equal(res.status, 403);
});

test('POST /clients/:id/payments queda reservado a dueña/técnico', async () => {
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: true }) };
  const res = await supertest(app)
    .post('/clients/c1/payments')
    .set('Authorization', `Bearer ${token()}`)
    .send({ amountUsd: 10, method: 'efectivo' });
  assert.equal(res.status, 403);
});

test('GET /clients/:id bloquea cross-tenant', async () => {
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: true }) };
  prisma.client = {
    findUnique: async () => ({ id: 'c-ajeno', tenantId: 'tenant-ajeno', fullName: 'Ajena', whatsapp: '+593', active: true }),
  };

  const res = await supertest(app).get('/clients/c-ajeno').set('Authorization', `Bearer ${token()}`);
  assert.equal(res.status, 403);
});

test('GET /search exige permiso clientes y devuelve resultados mínimos tenant-scoped', async () => {
  let argsSeen = null;
  mockAccessScheduleUser('dueno');
  prisma.client = {
    findMany: async (args) => {
      argsSeen = args;
      return [{ id: 'c1', fullName: 'Andrea Duque', whatsapp: '+593993629259' }];
    },
  };

  const res = await supertest(app)
    .get('/search?q=Andrea')
    .set('Authorization', `Bearer ${token({ role: 'dueno' })}`);

  assert.equal(res.status, 200);
  assert.equal(argsSeen.where.tenantId, 't1');
  assert.equal(argsSeen.take, 10);
  assert.deepEqual(res.body, [{ type: 'client', id: 'c1', name: 'Andrea Duque', phone: '+593993629259' }]);
});

test('GET /search niega a personal sin permiso clientes', async () => {
  mockAccessScheduleUser();
  prisma.rolePermission = { findUnique: async () => ({ clientes: false }) };

  const res = await supertest(app)
    .get('/search?q=Andrea')
    .set('Authorization', `Bearer ${token({ role: 'personal' })}`);

  assert.equal(res.status, 403);
});

test('GET /users requiere dueno/superadmin y no devuelve passwordHash', async () => {
  let argsSeen = null;
  prisma.user = {
    findUnique: async () => ({
      id: 'u1', tenantId: 't1', email: 'u1@test.com', role: 'dueno',
      active: true, sessionVersion: 0, accessSchedule: null,
    }),
    findMany: async (args) => {
      argsSeen = args;
      return [{
        id: 'u2', tenantId: 't1', email: 'daniela@alma.test', name: 'Daniela Mora', role: 'personal',
        isProtected: false, active: true, canAttendAppointments: true, rolePermission: { agenda: true },
        passwordHash: 'hash-que-no-sale',
      }];
    },
  };

  const res = await supertest(app).get('/users').set('Authorization', `Bearer ${token({ role: 'dueno' })}`);
  assert.equal(res.status, 200);
  assert.equal(argsSeen.where.tenantId, 't1');
  assert.equal('passwordHash' in argsSeen.select, false);
  assert.equal('passwordHash' in res.body[0], false);
  assert.equal(res.body[0].isProtected, false);
});
