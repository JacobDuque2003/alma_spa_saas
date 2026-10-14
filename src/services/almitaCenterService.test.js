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

  const tenantConfig = { workDays: [1, 2, 3, 4, 5], businessHours: { start: '09:00', end: '12:00' } };
  prisma.tenant = { findUnique: async () => ({ id: 't1', slug: 'alma-spa', name: 'Alma Spa', config: tenantConfig }) };
  prisma.almitaConfiguration = { findFirst: async () => ({ version: 2, personality: 'Cálida', instructions: 'Sé precisa', dailyBriefing: 'Sin promociones' }) };
  prisma.almitaKnowledge = {
    findMany: async () => [
      { id: 'k1', audience: 'PUBLIC', active: true, category: 'Servicios', title: 'Masaje relajante', content: 'Dura 60 minutos.', source: 'catálogo', priority: 10 },
      { id: 'k2', audience: 'PUBLIC', active: true, category: 'Ubicación', title: 'Dirección', content: 'Zamora.', source: 'manual', priority: 100 },
      { id: 'private', audience: 'INTERNAL', active: true, category: 'Servicios', title: 'Masaje relajante', content: 'PRIVATE_SIMULATION', priority: 100 },
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
    assert.deepEqual(aiContext.tenantConfig, tenantConfig);
    assert.doesNotMatch(JSON.stringify(aiContext), /PRIVATE_SIMULATION/);
  } finally {
    aiClient.isAvailable = originalAvailable;
    aiClient.chat = originalChat;
  }
});

test('simulation rules handle advisor, greetings and closed days without claiming real actions', () => {
  const rule = service._internals.simulationRule;
  const config = { workDays: [1, 2, 3, 4, 5], businessHours: { start: '09:00', end: '19:00' } };
  assert.equal(rule('Hola!', 'tu', config).intent, 'greeting');
  assert.match(rule('prefiero a una persona', 'tu', config).reply, /no se envían avisos/);
  assert.equal(rule('contactar a un asesor', 'tu', config).intent, 'escalate');
  assert.match(rule('el sábado', 'tu', config).reply, /lunes a viernes/);
  assert.equal(rule('el sábado', 'tu', { ...config, workDays: [6] }), null);
  assert.equal(rule('quiero un masaje relajante', 'tu', config), null);
  assert.equal(rule('no puedo el sábado', 'tu', config), null);
});

test('source ranking ignores generic words and matches whole meaningful tokens', () => {
  const score = service._internals.relevanceScore;
  const row = { category: 'Ubicación', title: 'Mapa', content: 'Cuando alguien pregunte dónde queda el spa, indicar esta dirección.', priority: 100 };
  assert.ok(score('de qué trata ese servicio', row) < 1000);
  assert.ok(score('masaje', { content: 'masajes relajantes' }) >= 1000);
  assert.ok(score('mas', { content: 'masajes relajantes' }) < 1000);
});

test('simulator deduplicates the current turn and preserves catalog and public-source context', async (t) => {
  const history = [{ role: 'user', content: 'quiero un masaje relajante' }, { role: 'assistant', content: '¿Qué desea conocer?' }, { role: 'user', content: 'de qué trata ese servicio' }];
  prisma.tenant = { findUnique: async () => ({ id: 't1', config: { workDays: [1, 2, 3, 4, 5] } }) };
  prisma.almitaConfiguration = { findFirst: async () => ({ version: 1 }) };
  prisma.almitaKnowledge = { findMany: async () => [{ id: 'k1', title: 'Masajes relajantes', content: 'Descripción aprobada', audience: 'PUBLIC', active: true }] };
  prisma.almitaApprovedExample = { findMany: async () => [] };
  prisma.service = { findMany: async () => [{ id: 's1', name: 'Masajes relajantes', priceUsd: 30, durationMins: 105 }] };
  t.mock.method(aiClient, 'isAvailable', () => true);
  t.mock.method(aiClient, 'chat', async (message, context) => {
    assert.equal(context.history.length, 2);
    assert.equal(context.almitaCenter.knowledge[0].id, 'k1');
    return { ok: true, intent: 'service_info', replyText: 'Descripción.', params: { service_query: 'Masaje relajante' } };
  });
  const result = await service.simulate(superadmin, undefined, { message: 'de qué trata ese servicio', history });
  assert.ok(result.sources.some((row) => row.id === 's1' && row.source === 'Catálogo de servicios'));
  t.mock.method(aiClient, 'isAvailable', () => false);
  t.mock.method(aiClient, 'chat', async () => { throw new Error('No AI calls expected'); });
  for (const message of ['hola', 'el sábado', 'prefiero a una persona']) {
    const fast = await service.simulate(superadmin, undefined, { message });
    assert.equal(fast.handler, 'Reglas');
    assert.equal(fast.usage.totalTokens, 0);
    assert.equal(fast.usage.costUsd, 0);
  }
});

test('provider failures have safe actionable diagnostics without leaking the raw error', async (t) => {
  t.mock.method(aiClient, 'isAvailable', () => true);
  t.mock.method(aiClient, 'chat', async () => ({ ok: false, error: 'Anthropic request timeout SECRET' }));
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  await assert.rejects(service.simulate(superadmin, undefined, { message: 'quiero un masaje relajante' }), (error) => error.status === 504 && /tardó demasiado/.test(error.message) && !/SECRET/.test(error.message));
  assert.equal(warnings[0][1].code, 'AI_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(warnings), /SECRET|masaje/);
});

test('audience defaults to INTERNAL, validates enum, and partial edits preserve classification and metadata', () => {
  const knowledge = { category: 'General', title: 'Ficha', content: 'Texto', source: 'manual', priority: 80 };
  const example = { userMessage: 'hola', expectedIntent: 'greeting', expectedReply: 'Hola.' };
  for (const [validator, body] of [[service._internals.validateKnowledge, knowledge], [service._internals.validateExample, example]]) {
    assert.equal(validator(body).audience, 'INTERNAL');
    assert.equal(validator({ ...body, audience: 'PUBLIC' }).audience, 'PUBLIC');
    assert.deepEqual(validator({ audience: 'PUBLIC' }, true), { audience: 'PUBLIC' });
    assert.ok(!Object.hasOwn(validator(body, true), 'audience'));
    for (const audience of [null, '', 'public', 'approved', true]) assert.throws(() => validator({ ...body, audience }), /audience/);
  }
  assert.deepEqual(service._internals.validateKnowledge({ title: 'Título editado' }, true), { title: 'Título editado' });
});

test('configuration validators admit all supported characters and reject overflow', () => {
  const body = { personality: 'p'.repeat(5000), instructions: 'i'.repeat(12000), dailyBriefing: 'b'.repeat(5000) };
  assert.deepEqual(service._internals.validateConfiguration(body), body);
  for (const field of Object.keys(body)) assert.throws(() => service._internals.validateConfiguration({ ...body, [field]: body[field] + 'x' }), /no puede superar/);
});

test('runtime scopes queries to tenant and PUBLIC active rows and filters again before selection', async () => {
  const queries = {};
  const tenantConfig = { workDays: [1, 2, 3, 4, 5], businessHours: { start: '10:00', end: '18:00' }, internalSecret: 'CONFIG_SECRET' };
  prisma.tenant = { findUnique: async (args) => { queries.tenant = args; return { config: tenantConfig }; } };
  prisma.almitaConfiguration = { findFirst: async (args) => { queries.configuration = args; return null; } };
  const states = [
    { audience: 'INTERNAL', active: true }, { active: true }, { audience: null, active: true },
    { audience: 'PUBLIC', active: false }, { audience: 'PUBLIC' },
  ];
  prisma.almitaKnowledge = { findMany: async (args) => {
    queries.knowledge = args;
    return [
      ...states.map((state, index) => ({ ...state, id: `private${index}`, title: 'masaje', category: 'Publico', content: `PRIVATE_K_${index}`, priority: 100 })),
      { id: 'public', audience: 'PUBLIC', active: true, title: 'masaje', category: 'Interno', content: 'PUBLIC_K', priority: 1 },
    ];
  } };
  prisma.almitaApprovedExample = { findMany: async (args) => {
    queries.examples = args;
    return [
      ...states.map((state, index) => ({ ...state, id: `private${index}`, userMessage: 'masaje', expectedIntent: 'service_info', expectedReply: `PRIVATE_EX_${index}` })),
      { id: 'public-example', audience: 'PUBLIC', active: true, userMessage: 'masaje', expectedIntent: 'service_info', expectedReply: 'PUBLIC_EX' },
    ];
  } };
  prisma.service = { findMany: async (args) => {
    queries.services = args;
    return [
      { id: 'commercial', name: 'Masaje', category: 'Masajes', active: true, priceUsd: 0 },
      { id: 'birthday', name: 'Cumpleaños', category: 'General', active: true },
      { id: 'shop', name: 'Producto', category: 'Tienda', active: true },
      { id: 'reminder', name: 'Aviso', category: 'Recordatorio', active: true },
      { id: 'paused', name: 'Masaje', category: 'Masajes', active: false },
    ];
  } };
  const result = await service.loadRuntimeContext('tenant-synthetic', 'masaje');
  for (const name of ['knowledge', 'examples']) assert.deepEqual(queries[name].where, { tenantId: 'tenant-synthetic', active: true, audience: 'PUBLIC' });
  assert.equal(queries.configuration.where.tenantId, 'tenant-synthetic');
  assert.deepEqual(queries.tenant, { where: { id: 'tenant-synthetic' }, select: { config: true } });
  assert.deepEqual(queries.services.where, require('../utils/customerServicePolicy').customerServiceWhere('tenant-synthetic'));
  assert.deepEqual(result.knowledge.map((row) => row.id), ['public']);
  assert.deepEqual(result.examples.map((row) => row.id), ['public-example']);
  assert.deepEqual(result.services.map((row) => row.id), ['commercial']);
  assert.deepEqual(result.tenantConfig, tenantConfig);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  const prompt = aiClient._internals.buildChatSystemPrompt({ tenantConfig: result.tenantConfig, services: result.services, almitaCenter: { knowledge: result.knowledge, examples: result.examples } });
  assert.doesNotMatch(prompt, /CONFIG_SECRET|PRIVATE_/);
});

test('only superadmin may explicitly publish knowledge or examples', async () => {
  for (const actor of [{ role: 'dueno' }, { role: 'personal' }, null]) {
    await assert.rejects(() => service.updateKnowledge(actor, 't1', 'k1', { audience: 'PUBLIC' }), (error) => error.status === 403);
    await assert.rejects(() => service.updateExample(actor, 't1', 'e1', { audience: 'PUBLIC' }), (error) => error.status === 403);
  }
  prisma.tenant = { findUnique: async () => ({ id: 't1' }) };
  prisma.almitaKnowledge = {
    findFirst: async ({ where }) => { assert.deepEqual(where, { id: 'k1', tenantId: 't1' }); return { id: 'k1' }; },
    update: async (args) => { assert.deepEqual(args, { where: { id: 'k1' }, data: { audience: 'PUBLIC' } }); return { id: 'k1', audience: 'PUBLIC', priority: 90, source: 'original', content: 'Texto preservado' }; },
  };
  const row = await service.updateKnowledge(superadmin, 't1', 'k1', { audience: 'PUBLIC' });
  assert.equal(row.content, 'Texto preservado');
  assert.equal(row.priority, 90);
  assert.equal(row.source, 'original');
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
