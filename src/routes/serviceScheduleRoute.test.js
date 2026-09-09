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

function mockAccessScheduleUser() {
  prisma.user = {
    findUnique: async () => ({
      id: 'u1',
      tenantId: 't1',
      role: 'personal',
      email: 'u1@test.com',
      active: true,
      sessionVersion: 0,
      accessSchedule: null,
    }),
  };
  prisma.tenant = { findUnique: async () => ({ config: { timezone: 'America/Guayaquil' } }) };
}

test('PATCH /services/:id/schedule permite configuracionHorario sin tocar otros campos', async () => {
  mockAccessScheduleUser();
  prisma.rolePermission = {
    findUnique: async () => ({ configuracionHorario: true, configuracionServicios: false }),
  };
  prisma.adminAuditLog = { create: async () => ({}) };

  let updateData = null;
  prisma.service = {
    findUnique: async () => ({
      id: 's1',
      tenantId: 't1',
      name: 'Servicio original',
      category: 'facial',
      active: true,
      appointmentSchedule: null,
    }),
    update: async ({ data }) => {
      updateData = data;
      return { id: 's1', tenantId: 't1', ...data };
    },
  };
  prisma.$transaction = async (fn) => fn(prisma);

  const appointmentSchedule = {
    monday: { morning: { start: '09:00', end: '12:00' }, afternoon: null },
  };
  const res = await supertest(app)
    .patch('/services/s1/schedule')
    .set('Authorization', `Bearer ${token()}`)
    .send({ appointmentSchedule, name: 'No debe cambiar' });

  assert.equal(res.status, 200);
  assert.deepEqual(updateData, { appointmentSchedule });
  assert.equal(res.body.name, undefined);
});
