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

function mockBaseUser(role = 'dueno') {
  prisma.user = {
    findUnique: async (args) => {
      if (args.select?.active && Object.keys(args.select).length === 1) {
        return { active: true };
      }
      return {
        id: role === 'personal' ? 'u-personal' : 'u-dueno',
        name: 'Gianella',
        email: `${role}@alma.test`,
        role,
        tenantId: 't1',
        active: true,
        sessionVersion: 0,
        tenant: { active: true, billingStatus: 'active' },
      };
    },
  };
}

function mockStatusModels() {
  prisma.$queryRaw = async () => [{ ok: 1 }];
  prisma.tenant = {
    findUnique: async () => ({ id: 't1', name: 'ALMA SPA', slug: 'alma-spa', config: { timezone: 'America/Guayaquil' } }),
    findFirst: async () => ({ id: 't1' }),
  };
  prisma.whatsAppConnection = {
    findUnique: async () => ({
      connectedAt: new Date('2099-08-01T14:00:00.000Z'),
      displayPhone: '+593 99 999 9999',
      lastError: null,
      lastVerifiedAt: new Date('2099-08-01T14:05:00.000Z'),
      phoneNumberId: '123456',
      status: 'activo',
      wabaId: '999',
      accessTokenEnc: Buffer.from('secret'),
    }),
  };
  prisma.whatsAppMessage = {
    findFirst: async ({ where }) => {
      if (where.direction === 'inbound') {
        return {
          id: 'm-in',
          createdAt: new Date(),
          direction: 'inbound',
          senderType: 'customer',
          type: 'text',
          status: 'received',
          body: 'Hola',
          errorCode: null,
          errorTitle: null,
        };
      }
      return {
        id: 'm-out',
        createdAt: new Date(),
        direction: 'outbound',
        senderType: 'bot',
        type: 'text',
        status: 'sent',
        body: 'Con gusto',
        errorCode: null,
        errorTitle: null,
      };
    },
    findMany: async () => [
      {
        id: 'm-err',
        createdAt: new Date('2099-08-01T15:00:00.000Z'),
        direction: 'outbound',
        senderType: 'bot',
        type: 'interactive',
        status: 'failed',
        body: 'payload',
        errorCode: '131000',
        errorTitle: 'Meta rechazó el mensaje',
      },
    ],
  };
  prisma.botInteractionLog = {
    aggregate: async () => ({ _sum: { costUsd: 0.012345 } }),
    count: async () => 3,
  };
}

test('GET /system/status devuelve señales de integraciones sin secretos', async () => {
  mockBaseUser('dueno');
  mockStatusModels();
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalBucket = process.env.GCS_BUCKET;
  const originalKey = process.env.GCS_SERVICE_ACCOUNT_KEY;
  const originalDb = process.env.DATABASE_URL;
  process.env.ANTHROPIC_API_KEY = 'anthropic-secret';
  process.env.GCS_BUCKET = 'alma-backups';
  process.env.GCS_SERVICE_ACCOUNT_KEY = '{"client_email":"svc@example.com"}';
  process.env.DATABASE_URL = 'postgres://secret';

  try {
    const token = signToken({ id: 'u-dueno', role: 'dueno', tenantId: 't1' });
    const res = await supertest(app)
      .get('/system/status')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.tenant.slug, 'alma-spa');
    assert.equal(res.body.database.connected, true);
    assert.equal(res.body.whatsapp.connected, true);
    assert.equal(res.body.webhook.status, 'active');
    assert.equal(res.body.ai.configured, true);
    assert.equal(res.body.ai.todayInteractions, 3);
    assert.equal(res.body.metaErrors.count, 1);
    assert.equal(res.body.backups.configured, true);
    const serialized = JSON.stringify(res.body);
    assert.equal(serialized.includes('anthropic-secret'), false);
    assert.equal(serialized.includes('postgres://secret'), false);
    assert.equal(serialized.includes('GCS_SERVICE_ACCOUNT_KEY'), false);
    assert.equal(serialized.includes('accessTokenEnc'), false);
  } finally {
    if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropic;
    if (originalBucket === undefined) delete process.env.GCS_BUCKET;
    else process.env.GCS_BUCKET = originalBucket;
    if (originalKey === undefined) delete process.env.GCS_SERVICE_ACCOUNT_KEY;
    else process.env.GCS_SERVICE_ACCOUNT_KEY = originalKey;
    if (originalDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDb;
  }
});

test('GET /system/status bloquea personal', async () => {
  mockBaseUser('personal');
  prisma.tenant = {
    findUnique: async () => ({ id: 't1', config: { timezone: 'America/Guayaquil' } }),
  };
  prisma.rolePermission = {
    findUnique: async () => ({ agenda: true }),
  };
  const token = signToken({ id: 'u-personal', role: 'personal', tenantId: 't1' });
  const res = await supertest(app)
    .get('/system/status')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 403);
});
