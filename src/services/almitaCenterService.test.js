const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const aiClient = require('./aiClient');
const service = require('./almitaCenterService');

const superadmin = { id: 'root', role: 'superadmin', tenantId: null };

test('createConfiguration crea una versión nueva y desactiva la anterior', async () => {
  const calls = [];
  prisma.tenant = { findUnique: async () => ({ id: 't1', slug: 'alma-spa', name: 'Alma Spa' }) };
  prisma.almitaConfiguration = {
    findFirst: async () => ({ version: 3 }),
    updateMany: async (args) => { calls.push(['updateMany', args]); return { count: 1 }; },
    create: async (args) => { calls.push(['create', args]); return { id: 'cfg4', ...args.data }; },
  };
  prisma.$transaction = async (callback) => callback(prisma);

  const result = await service.createConfiguration(superadmin, undefined, {
    personality: 'Cálida, clara y breve.',
    instructions: 'Responder únicamente con información aprobada.',
    dailyBriefing: 'Hoy no existen promociones especiales.',
  });

  assert.equal(result.version, 4);
  assert.equal(result.tenantId, 't1');
  assert.equal(result.createdById, 'root');
  assert.equal(calls[0][0], 'updateMany');
  assert.equal(calls[1][0], 'create');
});

test('updateKnowledge mantiene tenant scope y no actualiza registros ajenos', async () => {
  prisma.tenant = { findUnique: async () => ({ id: 't1', slug: 'alma-spa', name: 'Alma Spa' }) };
  prisma.almitaKnowledge = { findFirst: async () => null };
  await assert.rejects(
    () => service.updateKnowledge(superadmin, 't1', 'knowledge-other-tenant', { title: 'Nuevo título' }),
    (error) => error.status === 404
  );
});

test('simulate devuelve intención, fuentes y consumo sin escribir efectos de negocio', async () => {
  const originalAvailable = aiClient.isAvailable;
  const originalChat = aiClient.chat;
  let aiContext;
  aiClient.isAvailable = () => true;
  aiClient.chat = async (message, context) => {
    aiContext = context;
    return {
      ok: true,
      intent: 'service_info',
      replyText: 'El masaje relajante dura 60 minutos.',
      params: { service_query: 'Masaje relajante' },
      model: 'test-model',
      inputTokens: 120,
      outputTokens: 20,
      totalTokens: 140,
      costUsd: 0.00022,
    };
  };

  prisma.tenant = { findUnique: async () => ({ id: 't1', slug: 'alma-spa', name: 'Alma Spa' }) };
  prisma.almitaConfiguration = { findFirst: async () => ({ version: 2, personality: 'Cálida', instructions: 'Sé precisa', dailyBriefing: 'Sin promociones' }) };
  prisma.almitaKnowledge = {
    findMany: async () => [
      { id: 'k1', category: 'Servicios', title: 'Masaje relajante', content: 'Dura 60 minutos.', source: 'catálogo', priority: 10 },
      { id: 'k2', category: 'Ubicación', title: 'Dirección', content: 'Zamora.', source: 'manual', priority: 100 },
    ],
  };
  prisma.almitaApprovedExample = { findMany: async () => [] };
  prisma.service = { findMany: async () => [{ id: 's1', name: 'Masaje relajante', category: 'Masajes', priceUsd: 30, durationMins: 60, description: 'Bienestar' }] };

  try {
    const result = await service.simulate(superadmin, undefined, { message: '¿Cuánto dura el masaje relajante?' });
    assert.equal(result.intent, 'service_info');
    assert.equal(result.params.service_query, 'Masaje relajante');
    assert.equal(result.sources[0].id, 'k1');
    assert.equal(result.usage.totalTokens, 140);
    assert.equal(result.configurationVersion, 2);
    assert.equal(aiContext.almitaCenter.knowledge[0].id, 'k1');
  } finally {
    aiClient.isAvailable = originalAvailable;
    aiClient.chat = originalChat;
  }
});

test('validadores rechazan longitudes y prioridad fuera de rango', () => {
  assert.throws(
    () => service._internals.validateKnowledge({ category: 'A', title: 'B', content: 'C', source: 'manual', priority: 101 }),
    /priority/
  );
  assert.throws(
    () => service._internals.validateExample({ userMessage: 'hola', expectedIntent: 'inventada', expectedReply: 'hola' }),
    /expectedIntent/
  );
});

test('getMetrics agrega consumo únicamente para el tenant objetivo', async () => {
  prisma.tenant = { findUnique: async () => ({ id: 't1', slug: 'alma-spa', name: 'Alma Spa' }) };
  let aggregateWhere;
  prisma.botInteractionLog = {
    aggregate: async ({ where }) => {
      aggregateWhere = where;
      return { _count: { _all: 2 }, _sum: { promptTokens: 200, completionTokens: 40, totalTokens: 240, costUsd: '0.000400', latencyMs: 600 } };
    },
    groupBy: async () => [{ detectedIntent: 'service_info', _count: { _all: 2 } }],
  };

  const result = await service.getMetrics(superadmin, 't1', { from: '2026-10-01', to: '2026-10-07T23:59:59.000Z' });
  assert.equal(aggregateWhere.tenantId, 't1');
  assert.equal(result.interactions, 2);
  assert.equal(result.totalTokens, 240);
  assert.equal(result.costUsd, 0.0004);
  assert.equal(result.averageLatencyMs, 300);
  assert.deepEqual(result.byIntent, [{ intent: 'service_info', count: 2 }]);
});
