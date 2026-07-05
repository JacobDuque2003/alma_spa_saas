const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const protectSuperadmin = require('./protectSuperadmin');

function callMiddleware(req) {
  return new Promise((resolve) => {
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve({ res: this, nextCalled: false }); } };
    const next = () => resolve({ res, nextCalled: true });
    protectSuperadmin(req, res, next).catch(() => {});
  });
}

test('protectSuperadmin bloquea con 403 cuando el usuario objetivo es isProtected', async () => {
  prisma.user = { findUnique: async () => ({ id: 'root', isProtected: true }) };
  const { res, nextCalled } = await callMiddleware({ params: { id: 'root' } });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('protectSuperadmin deja pasar cuando el usuario objetivo no es protegido', async () => {
  prisma.user = { findUnique: async () => ({ id: 'u2', isProtected: false }) };
  const { nextCalled } = await callMiddleware({ params: { id: 'u2' } });
  assert.equal(nextCalled, true);
});

test('protectSuperadmin deja pasar cuando el usuario objetivo no existe (404 lo maneja la ruta)', async () => {
  prisma.user = { findUnique: async () => null };
  const { nextCalled } = await callMiddleware({ params: { id: 'no-existe' } });
  assert.equal(nextCalled, true);
});
