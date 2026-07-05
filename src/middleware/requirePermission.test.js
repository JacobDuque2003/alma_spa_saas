const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const requirePermission = require('./requirePermission');

function callMiddleware(mw, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        resolve({ res: this, nextCalled: false });
      },
    };
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
      resolve({ res, nextCalled });
    };
    mw(req, res, next);
  });
}

test('requirePermission hace bypass total para dueno y superadmin sin tocar la DB', async () => {
  prisma.rolePermission = {
    findUnique: async () => {
      throw new Error('no debería consultarse la DB para dueno/superadmin');
    },
  };
  const mw = requirePermission('reportes');

  const { nextCalled } = await callMiddleware(mw, { user: { id: 'u1', role: 'dueno' } });
  assert.equal(nextCalled, true);

  const { nextCalled: nextCalled2 } = await callMiddleware(mw, { user: { id: 'u2', role: 'superadmin' } });
  assert.equal(nextCalled2, true);
});

test('requirePermission niega con 403 a personal sin el permiso del módulo', async () => {
  prisma.rolePermission = {
    findUnique: async () => ({ agenda: true, reportes: false }),
  };
  const mw = requirePermission('reportes');

  const { res, nextCalled } = await callMiddleware(mw, { user: { id: 'u3', role: 'personal' } });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('requirePermission permite a personal con el permiso del módulo activo', async () => {
  prisma.rolePermission = {
    findUnique: async () => ({ agenda: true }),
  };
  const mw = requirePermission('agenda');

  const { nextCalled } = await callMiddleware(mw, { user: { id: 'u4', role: 'personal' } });
  assert.equal(nextCalled, true);
});
