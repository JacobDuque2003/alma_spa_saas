const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const appointmentService = require('./appointmentService');

test('confirmBookingByToken: pendiente → confirmado', async () => {
  const future = new Date(Date.now() + 3600 * 1000);
  prisma.appointment = {
    findUnique: async () => ({ id: 'a1', status: 'pendiente', startsAt: future }),
    update: async ({ data }) => ({ id: 'a1', status: data.status, startsAt: future }),
  };
  const result = await appointmentService.confirmBookingByToken('token-x');
  assert.equal(result.status, 'confirmado');
});

test('confirmBookingByToken: idempotente si ya está confirmado', async () => {
  const future = new Date(Date.now() + 3600 * 1000);
  let updateCalled = false;
  prisma.appointment = {
    findUnique: async () => ({ id: 'a1', status: 'confirmado', startsAt: future }),
    update: async () => { updateCalled = true; return {}; },
  };
  const result = await appointmentService.confirmBookingByToken('token-x');
  assert.equal(result.status, 'confirmado');
  assert.equal(updateCalled, false, 'no debe llamarse update en idempotente');
});

test('confirmBookingByToken: cita pasada → 400', async () => {
  prisma.appointment = {
    findUnique: async () => ({ id: 'a1', status: 'pendiente', startsAt: new Date(Date.now() - 3600 * 1000) }),
  };
  await assert.rejects(
    () => appointmentService.confirmBookingByToken('token-x'),
    (err) => err.status === 400 && /ya pasó/.test(err.message)
  );
});

test('confirmBookingByToken: cancelada no puede confirmarse', async () => {
  prisma.appointment = {
    findUnique: async () => ({ id: 'a1', status: 'cancelado', startsAt: new Date(Date.now() + 3600 * 1000) }),
  };
  await assert.rejects(
    () => appointmentService.confirmBookingByToken('token-x'),
    (err) => err.status === 400
  );
});
