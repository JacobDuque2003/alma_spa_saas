const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'a]G4k!mR#9sXw2Lp@vN7jQ6dY1bT0cFe';
process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const accessSchedule = require('./accessSchedule');

function denyAllSchedule() {
  return {
    alwaysAllowed: false,
    sunday: null,
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
  };
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('accessSchedule permite GET fuera de horario y marca modo solo lectura', async () => {
  prisma.user = { findUnique: async () => ({ accessSchedule: denyAllSchedule(), active: true }) };
  prisma.tenant = { findUnique: async () => ({ config: { timezone: 'America/Guayaquil' } }) };
  prisma.adminAuditLog = { create: async () => { throw new Error('GET no debe auditar denial'); } };

  const req = {
    method: 'GET',
    user: { id: 'u1', email: 'staff@alma.test', role: 'personal', tenantId: 't1' },
  };
  const res = mockResponse();
  let nextCalled = false;

  await accessSchedule(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['X-Alma-Out-Of-Schedule'], '1');
});

test('accessSchedule bloquea mutaciones fuera de horario con reason outOfSchedule', async () => {
  prisma.user = { findUnique: async () => ({ accessSchedule: denyAllSchedule(), active: true }) };
  prisma.tenant = { findUnique: async () => ({ config: { timezone: 'America/Guayaquil' } }) };
  prisma.adminAuditLog = { create: async () => ({ id: 'log1' }) };
  accessSchedule._auditedToday.clear();

  const req = {
    method: 'PATCH',
    user: { id: 'u2', email: 'staff@alma.test', role: 'personal', tenantId: 't1' },
  };
  const res = mockResponse();
  let nextCalled = false;

  await accessSchedule(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.reason, 'outOfSchedule');
});
