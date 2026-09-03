const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const prisma = require('../utils/prisma');
const { signToken } = require('../utils/jwt');
const authenticate = require('./authenticate');

function callMiddleware(req) {
  return new Promise((resolve) => {
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve({ res: this, nextCalled: false }); } };
    const next = () => resolve({ res, nextCalled: true });
    authenticate(req, res, next);
  });
}

test('authenticate rechaza con 401 si no hay header Authorization', async () => {
  const { res, nextCalled } = await callMiddleware({ headers: {} });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('authenticate rechaza con 401 si el token es inválido', async () => {
  const { res, nextCalled } = await callMiddleware({ headers: { authorization: 'Bearer token-invalido' } });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('authenticate deriva req.user del JWT (nunca de params/body/query)', async () => {
  // accessSchedule (post-authenticate) hace su propio prisma.user.findUnique
  // para el chequeo de cuenta activa del rol dueño; sin este mock cae en la
  // instancia real de Prisma, no encuentra a 'u1' y responde 401 sin llamar
  // a next(), aunque req.user ya se derivó correctamente del JWT. El mismo
  // mock también atiende el backfill de email de authenticate.js (línea 24),
  // por eso incluye email:null explícito — sin él, u.email sale undefined y
  // pisa el default null que el JWT sin email ya había fijado en req.user.
  prisma.user = { findUnique: async () => ({ id: 'u1', tenantId: 't1', role: 'dueno', active: true, email: null, sessionVersion: 0 }) };
  const token = signToken({ id: 'u1', tenantId: 't1', role: 'dueno' });
  const req = { headers: { authorization: `Bearer ${token}` }, params: { tenantId: 'tenant-forjado' }, body: { tenantId: 'otro-forjado' } };
  const { nextCalled } = await callMiddleware(req);
  assert.equal(nextCalled, true);
  assert.deepEqual(req.user, { id: 'u1', tenantId: 't1', role: 'dueno', email: null });
});

test('authenticate propaga tenantId null para superadmin', async () => {
  prisma.user = { findUnique: async () => ({ id: 'root', tenantId: null, role: 'superadmin', active: true, email: null, sessionVersion: 0 }) };
  const token = signToken({ id: 'root', tenantId: null, role: 'superadmin' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  await callMiddleware(req);
  assert.equal(req.user.tenantId, null);
  assert.equal(req.user.role, 'superadmin');
});

test('authenticate invalida inmediatamente un token de una versión anterior de la cuenta', async () => {
  prisma.user = { findUnique: async () => ({ id: 'u1', tenantId: 't1', role: 'personal', active: true, email: 'u1@test.com', sessionVersion: 3 }) };
  const token = signToken({ id: 'u1', tenantId: 't1', role: 'personal', sessionVersion: 2 });
  const req = { headers: { authorization: `Bearer ${token}` } };

  const { res, nextCalled } = await callMiddleware(req);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /cuenta actualizada/i);
});
