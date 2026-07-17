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

test('GET /auth/me devuelve permisos efectivos para personal y nunca passwordHash', async () => {
  prisma.user = {
    findUnique: async (args) => {
      assert.equal(args.select.passwordHash, undefined);
      assert.equal(args.select.rolePermission, true);
      return {
        id: 'u-personal',
        name: 'Daniela Mora',
        email: 'daniela@alma.test',
        role: 'personal',
        tenantId: 't1',
        passwordHash: 'hash-que-no-debe-salir',
        rolePermission: {
          agenda: true,
          gabinetes: true,
          clientes: true,
          crm: false,
          reportes: false,
          configuracion: false,
        },
      };
    },
  };

  const token = signToken({ id: 'u-personal', tenantId: 't1', role: 'personal' });
  const res = await supertest(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.email, 'daniela@alma.test');
  assert.deepEqual(res.body.permissions, {
    agenda: true,
    gabinetes: true,
    clientes: true,
    crm: false,
    reportes: false,
    configuracion: false,
  });
  assert.equal('passwordHash' in res.body, false);
  assert.equal('rolePermission' in res.body, false);
});

test('GET /auth/me devuelve todos los permisos efectivos para dueno', async () => {
  prisma.user = {
    findUnique: async () => ({
      id: 'u-dueno',
      name: 'Mariana Rios',
      email: 'mariana@alma.test',
      role: 'dueno',
      tenantId: 't1',
      rolePermission: null,
    }),
  };

  const token = signToken({ id: 'u-dueno', tenantId: 't1', role: 'dueno' });
  const res = await supertest(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.permissions, {
    agenda: true,
    gabinetes: true,
    clientes: true,
    crm: true,
    reportes: true,
    configuracion: true,
  });
});
