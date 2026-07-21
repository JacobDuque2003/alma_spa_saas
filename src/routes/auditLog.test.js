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

test('GET /audit-log returns 403 for personal role', async () => {
  prisma.user = {
    findUnique: async () => ({
      id: 'u-personal',
      name: 'Terapeuta',
      email: 'terapeuta@alma.test',
      role: 'personal',
      tenantId: 't1',
      isProtected: false,
      active: true,
      rolePermission: { agenda: true },
    }),
  };

  const token = signToken({ id: 'u-personal', role: 'personal', tenantId: 't1' });
  const res = await supertest(app)
    .get('/audit-log')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 403);
});

test('GET /audit-log returns 200 with rows for dueno role', async () => {
  prisma.user = {
    findUnique: async () => ({
      id: 'u-dueno',
      name: 'Dueña',
      email: 'duena@alma.test',
      role: 'dueno',
      tenantId: 't1',
      isProtected: false,
      active: true,
      rolePermission: null,
    }),
  };

  prisma.adminAuditLog = {
    findMany: async () => [
      { id: 'a1', tenantId: 't1', actorId: 'u-dueno', actorEmail: 'duena@alma.test', entity: 'user', entityId: 'u2', action: 'create', detail: { name: 'Test' }, createdAt: new Date() },
    ],
    count: async () => 1,
  };

  const token = signToken({ id: 'u-dueno', role: 'dueno', tenantId: 't1' });
  const res = await supertest(app)
    .get('/audit-log')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.rows.length, 1);
  assert.equal(res.body.rows[0].entity, 'user');
});

test('GET /audit-log returns 401 without token', async () => {
  const res = await supertest(app).get('/audit-log');
  assert.equal(res.status, 401);
});
