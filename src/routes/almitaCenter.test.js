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

function mockUser(role) {
  prisma.user = {
    findUnique: async () => ({
      id: `u-${role}`,
      email: `${role}@test.local`,
      role,
      tenantId: role === 'superadmin' ? null : 't1',
      active: true,
      sessionVersion: 0,
      tenant: role === 'superadmin' ? null : { active: true, billingStatus: 'active' },
    }),
  };
  if (role !== 'superadmin') {
    prisma.tenant = {
      findUnique: async () => ({ id: 't1', active: true, billingStatus: 'active', config: {} }),
    };
  }
}

function tokenFor(role) {
  return signToken({ id: `u-${role}`, role, tenantId: role === 'superadmin' ? null : 't1', sessionVersion: 0 });
}

test('Centro de Almita bloquea a dueña con 403', async () => {
  mockUser('dueno');
  const response = await supertest(app)
    .get('/almita-center/configuration')
    .set('Authorization', `Bearer ${tokenFor('dueno')}`);
  assert.equal(response.status, 403);
});

test('Centro de Almita bloquea a personal con 403', async () => {
  mockUser('personal');
  const response = await supertest(app)
    .get('/almita-center/knowledge')
    .set('Authorization', `Bearer ${tokenFor('personal')}`);
  assert.equal(response.status, 403);
});

test('GET configuration usa alma-spa por defecto para superadmin', async () => {
  mockUser('superadmin');
  let tenantLookup;
  prisma.tenant = {
    findUnique: async (args) => {
      tenantLookup = args;
      return { id: 't-alma', slug: 'alma-spa', name: 'Alma Spa' };
    },
  };
  prisma.almitaConfiguration = {
    findFirst: async ({ where }) => ({ id: 'cfg1', tenantId: where.tenantId, version: 1, active: true }),
  };

  const response = await supertest(app)
    .get('/almita-center/configuration')
    .set('Authorization', `Bearer ${tokenFor('superadmin')}`);

  assert.equal(response.status, 200);
  assert.deepEqual(tenantLookup.where, { slug: 'alma-spa' });
  assert.equal(response.body.configuration.tenantId, 't-alma');
});

test('POST knowledge aplica validación estricta', async () => {
  mockUser('superadmin');
  prisma.tenant = { findUnique: async () => ({ id: 't-alma', slug: 'alma-spa', name: 'Alma Spa' }) };

  const response = await supertest(app)
    .post('/almita-center/knowledge')
    .set('Authorization', `Bearer ${tokenFor('superadmin')}`)
    .send({ category: 'Servicios', title: 'Masajes', content: 'Contenido', source: 'manual', secret: 'no permitido' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /Campos no permitidos/);
});
