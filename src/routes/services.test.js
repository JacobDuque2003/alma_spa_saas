const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');

process.env.JWT_SECRET = 'synthetic-tests-only-secret-long-enough';
const prisma = require('../utils/prisma');
const { signToken } = require('../utils/jwt');
const router = require('./services');

function setup(role = 'dueno') {
  const actor = { id: 'actor', email: 'actor@test.local', role, tenantId: role === 'superadmin' ? null : 't1', active: true, sessionVersion: 0, tenant: { active: true, billingStatus: 'active' } };
  const seen = { listing: null, created: null, updated: null, audit: null };
  const target = { id: 's1', tenantId: 't1', active: true, category: 'Faciales', name: 'Facial', priceUsd: 30 };
  prisma.user = { findUnique: async () => actor };
  prisma.service = {
    findMany: async (args) => { seen.listing = args.where; return []; },
    findUnique: async ({ where, select }) => {
      const row = { ...target, tenantId: where.id === 'other' ? 't2' : 't1', imageData: Buffer.from('synthetic-image'), imageMimeType: 'image/png', imageUpdatedAt: new Date('2026-10-01T00:00:00Z') };
      return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
    },
    create: async ({ data }) => { seen.created = data; return { id: 'new', ...data }; },
    update: async ({ data }) => { seen.updated = data; return { ...target, ...data }; },
  };
  prisma.adminAuditLog = { create: async ({ data }) => { seen.audit = data; return {}; } };
  prisma.$transaction = async (fn) => fn(prisma);
  const app = express();
  app.use(express.json());
  app.use('/services', router);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const token = signToken({ id: actor.id, role, tenantId: actor.tenantId, sessionVersion: 0 });
  return { api: supertest(app), authorization: `Bearer ${token}`, seen };
}

test('Servicios e imagen exigen autenticacion', async () => {
  const { api } = setup();
  assert.equal((await api.get('/services')).status, 401);
  assert.equal((await api.get('/services/s1/image')).status, 401);
});

test('duena no puede leer editar ni ver imagen de otro tenant', async () => {
  const { api, authorization, seen } = setup();
  for (const path of ['/services/other', '/services/other/image']) {
    assert.equal((await api.get(path).set('Authorization', authorization)).status, 403);
  }
  const response = await api.patch('/services/other').set('Authorization', authorization).send({ priceUsd: 40 });
  assert.equal(response.status, 403);
  assert.equal(seen.updated, null);
  assert.equal(seen.audit, null);
});

test('duena ignora tenant forjado en listado y creacion', async () => {
  const { api, authorization, seen } = setup();
  assert.equal((await api.get('/services').query({ tenantId: 'forged' }).set('Authorization', authorization)).status, 200);
  assert.equal(seen.listing.tenantId, 't1');
  const response = await api.post('/services').set('Authorization', authorization).send({ tenantId: 'forged', name: 'Facial', category: 'Faciales', priceUsd: 30 });
  assert.equal(response.status, 201);
  assert.equal(seen.created.tenantId, 't1');
  assert.equal(seen.audit.tenantId, 't1');
});

test('soporte filtra tenant seleccionado y crea y edita con auditoria del servicio', async () => {
  const { api, authorization, seen } = setup('superadmin');
  assert.equal((await api.get('/services').query({ tenantId: 't1' }).set('Authorization', authorization)).status, 200);
  assert.equal(seen.listing.tenantId, 't1');
  assert.equal((await api.get('/services').set('Authorization', authorization)).status, 200);
  assert.equal('tenantId' in seen.listing, false);
  const create = await api.post('/services').set('Authorization', authorization).send({ tenantId: 't1', name: 'Facial', category: 'Faciales', priceUsd: 30 });
  assert.equal(create.status, 201);
  assert.equal(seen.audit.tenantId, 't1');
  const update = await api.patch('/services/s1').set('Authorization', authorization).send({ priceUsd: 40 });
  assert.equal(update.status, 200);
  assert.equal(seen.audit.tenantId, 't1');
  assert.equal(seen.audit.actorId, 'actor');
});

test('imagen privada revalida y comprueba autorizacion incluso con ETag conocido', async () => {
  const { api, authorization } = setup();
  const response = await api.get('/services/s1/image').set('Authorization', authorization);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'private, no-cache, must-revalidate');
  assert.match(response.headers.vary, /Authorization/);
  assert.match(response.headers.vary, /Cookie/);
  const cached = await api.get('/services/s1/image').set('Authorization', authorization).set('If-None-Match', response.headers.etag);
  assert.equal(cached.status, 304);
  assert.equal(cached.headers['cache-control'], 'private, no-cache, must-revalidate');
  assert.equal((await api.get('/services/s1/image').set('If-None-Match', response.headers.etag)).status, 401);
  assert.equal((await api.get('/services/other/image').set('Authorization', authorization).set('If-None-Match', response.headers.etag)).status, 403);
});
