const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

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
  const token = signToken({ id: 'u1', tenantId: 't1', role: 'dueno' });
  const req = { headers: { authorization: `Bearer ${token}` }, params: { tenantId: 'tenant-forjado' }, body: { tenantId: 'otro-forjado' } };
  const { nextCalled } = await callMiddleware(req);
  assert.equal(nextCalled, true);
  assert.deepEqual(req.user, { id: 'u1', tenantId: 't1', role: 'dueno', email: null });
});

test('authenticate propaga tenantId null para superadmin', async () => {
  const token = signToken({ id: 'root', tenantId: null, role: 'superadmin' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  await callMiddleware(req);
  assert.equal(req.user.tenantId, null);
  assert.equal(req.user.role, 'superadmin');
});
