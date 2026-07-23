const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const supertest = require('supertest');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'a]G4k!mR#9sXw2Lp@vN7jQ6dY1bT0cFe';
process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const app = require('../app');

const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('ValidPass123!', 4);

test('POST /auth/login returns 429 after 5 failed attempts', async () => {
  prisma.user = {
    findUnique: async () => ({
      id: 'u1', name: 'Test', email: 'target@alma.test', role: 'dueno',
      tenantId: 't1', passwordHash: hash, active: true,
    }),
  };

  const agent = supertest(app);
  const uniqueEmail = `rate-test-${Date.now()}@alma.test`;

  for (let i = 1; i <= 5; i++) {
    const res = await agent.post('/auth/login').send({ email: uniqueEmail, password: 'wrong' });
    assert.equal(res.status, 401, `attempt ${i} should be 401`);
  }

  const blocked = await agent.post('/auth/login').send({ email: uniqueEmail, password: 'wrong' });
  assert.equal(blocked.status, 429, 'attempt 6 should be 429');
  assert.match(blocked.body.error, /Demasiados intentos/);
});

test('POST /auth/login rate limit is per email+ip (different email not blocked)', async () => {
  prisma.user = {
    findUnique: async () => ({
      id: 'u2', name: 'Other', email: 'other@alma.test', role: 'dueno',
      tenantId: 't1', passwordHash: hash, active: true,
    }),
  };

  const agent = supertest(app);
  const otherEmail = `other-${Date.now()}@alma.test`;
  const res = await agent.post('/auth/login').send({ email: otherEmail, password: 'wrong' });
  assert.equal(res.status, 401, 'different email should not be blocked');
});
