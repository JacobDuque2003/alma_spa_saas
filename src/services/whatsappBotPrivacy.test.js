const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function installMock(path, exports) {
  const id = require.resolve(path);
  const mock = new Module(id);
  mock.exports = exports;
  mock.loaded = true;
  require.cache[id] = mock;
  return exports;
}

// Install mocks before loading the bot so no real DB or external client is loaded.
const prisma = installMock('../utils/prisma', new Proxy({}, {
  get(target, key) {
    if (key in target) return target[key];
    throw new Error(`Unexpected database access: ${String(key)}`);
  },
}));
const transport = installMock('./whatsappTransport', {});
const aiClient = installMock('./aiClient', {});
const almitaCenter = installMock('./almitaCenterService', {});
installMock('./appointmentService', {});
installMock('./serviceService', {});
installMock('./clientService', {});
installMock('./crmEventBus', { publish: () => {} });

const bot = require('./whatsappBot');
const state = require('./whatsappBot/state');
const rateLimit = require('./whatsappBot/rateLimit');
const WA_ID = '593000000001';
let sent, updates, historyQueries, aiCalls;

function fixture(tenantId, conversationId, waId = WA_ID, marker = conversationId) {
  return {
    tenant: { id: tenantId, slug: tenantId, config: {} },
    connection: { id: `connection-${tenantId}`, tenantId },
    conv: {
      id: conversationId, tenantId, customerWaId: waId, clientId: 'fixture-client',
      botState: { clientName: `fixture-${marker}`, history: [{ role: 'user', content: `history-${marker}` }] },
    },
    incoming: { type: 'text', text: { body: 'zzconsulta fixture' } },
  };
}

function scoped(input, callback) {
  return state.withConversation(input.tenant.id, input.conv.id, callback);
}

test.beforeEach((t) => {
  state._reset();
  rateLimit._reset();
  sent = [];
  updates = [];
  historyQueries = [];
  aiCalls = [];
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected network request'));
  transport.sendText = async (connection, to, body) => {
    sent.push({ tenantId: connection.tenantId, to, body });
    return { ok: true, data: { messages: [{ id: 'fixture-message' }] } };
  };
  prisma.whatsAppMessage = {
    findMany: async ({ where }) => {
      assert.ok(where.tenantId && where.conversationId);
      historyQueries.push(where);
      return [];
    },
    create: async ({ data }) => ({ id: 'fixture-message', ...data }),
  };
  prisma.whatsAppConversation = {
    update: async (args) => { updates.push(structuredClone(args)); return {}; },
  };
  prisma.botInteractionLog = {
    aggregate: async () => ({ _sum: { costUsd: 0 } }),
    create: async () => ({}),
  };
  prisma.client = { findFirst: async () => null };
  prisma.service = { findMany: async () => [] };
  almitaCenter.loadRuntimeContext = async () => ({ configuration: null, knowledge: [], examples: [] });
  almitaCenter.normalizeSearch = (value) => String(value).toLowerCase().trim();
  aiClient.isAvailable = () => true;
  aiClient.chat = async (body, context) => {
    aiCalls.push({ body, context: structuredClone(context) });
    return { ok: true, intent: 'chitchat', replyText: `reply-${context.clientName}`, params: {}, costUsd: 0 };
  };
});

for (const [name, ids] of [
  ['tenants sharing a waId and conversationId', [['tenant-a', 'conv'], ['tenant-b', 'conv']]],
  ['conversations sharing a tenant and waId', [['tenant-a', 'conv-a'], ['tenant-a', 'conv-b']]],
  ['contacts sharing a tenant', [['tenant-a', 'conv-a', WA_ID], ['tenant-a', 'conv-b', '593000000002']]],
]) {
  test(`main isolates hydrated state, AI history and persistence for concurrent ${name}`, async () => {
    const inputs = ids.map(([tenantId, conversationId, waId = WA_ID], index) => fixture(tenantId, conversationId, waId, `marker-${index}`));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    aiClient.chat = async (body, context) => {
      aiCalls.push({ body, context: structuredClone(context) });
      if (aiCalls.length === inputs.length) release();
      await gate;
      return { ok: true, intent: 'chitchat', replyText: `reply-${context.clientName}`, params: {}, costUsd: 0 };
    };
    await Promise.all(inputs.map((input) => bot.handleInboundMessage(input)));

    assert.equal(aiCalls.length, 2);
    assert.equal(sent.length, 2);
    for (const [index, input] of inputs.entries()) {
      const marker = `marker-${index}`;
      const call = aiCalls.find((item) => item.context.clientName === `fixture-${marker}`);
      assert.ok(call);
      assert.deepEqual(call.context.history, [
        { role: 'user', content: `history-${marker}` },
        { role: 'user', content: input.incoming.text.body },
      ]);
      const persisted = updates.find((item) => item.where.id === input.conv.id
        && item.data.botState?.clientName === `fixture-${marker}`);
      assert.ok(persisted);
      assert.deepEqual(persisted.data.botState.history, [
        ...call.context.history, { role: 'assistant', content: `reply-fixture-${marker}` },
      ]);
      scoped(input, () => assert.deepEqual(state.getHistory(input.conv.customerWaId), persisted.data.botState.history));
      assert.ok(historyQueries.some((where) => where.tenantId === input.tenant.id && where.conversationId === input.conv.id));
      assert.ok(sent.some((item) => item.tenantId === input.tenant.id && item.to === input.conv.customerWaId
        && item.body === `reply-fixture-${marker}`));
    }
    assert.equal(state.getFlowState(WA_ID), null);
  });
}

test('main never hydrates from legacy unscoped state or escalation', async () => {
  state.setFlowState(WA_ID, { clientName: 'fixture-legacy', history: [{ role: 'user', content: 'legacy-history' }] });
  state.markEscalated(WA_ID);
  const input = fixture('tenant-a', 'conv');
  delete input.conv.botState;
  await bot.handleInboundMessage(input);
  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].context.clientName, null);
  assert.deepEqual(aiCalls[0].context.history, [{ role: 'user', content: input.incoming.text.body }]);
  assert.equal(sent.length, 1);
  assert.deepEqual(state.getHistory(WA_ID), [{ role: 'user', content: 'legacy-history' }]);
  assert.equal(state.isEscalated(WA_ID), true);
  scoped(input, () => assert.equal(state.isEscalated(WA_ID), false));
});

test('main escalation blocks only the exact tenant and conversation', async () => {
  const blocked = fixture('tenant-a', 'conv');
  const others = [fixture('tenant-b', 'conv'), fixture('tenant-a', 'other-conv')];
  scoped(blocked, () => state.markEscalated(WA_ID));
  await Promise.all([blocked, ...others].map((input) => bot.handleInboundMessage({
    ...input, incoming: { type: 'audio' },
  })));
  assert.equal(sent.length, 2);
  assert.equal(aiCalls.length, 0);
  assert.equal(sent.filter((item) => item.tenantId === 'tenant-a').length, 1);
  for (const input of others) scoped(input, () => assert.equal(state.isEscalated(WA_ID), false));
  scoped(blocked, () => assert.equal(state.isEscalated(WA_ID), true));
});

test('main rejects missing or mismatched tenant scopes before any client call', async () => {
  let clientCalls = 0;
  aiClient.isAvailable = () => { clientCalls += 1; assert.fail('Invalid scope reached AI'); };
  prisma.whatsAppConversation.update = async () => { clientCalls += 1; assert.fail('Invalid scope reached persistence'); };
  prisma.client.findFirst = async () => { clientCalls += 1; assert.fail('Invalid scope reached client lookup'); };
  const input = fixture('tenant-a', 'conv');
  for (const invalid of [
    { ...input, tenant: {} },
    { ...input, conv: { ...input.conv, id: null } },
    { ...input, conv: { ...input.conv, tenantId: 'tenant-b' } },
  ]) await bot.handleInboundMessage(invalid);
  assert.equal(clientCalls, 0);
  assert.equal(sent.length, 0);
  assert.equal(updates.length, 0);
  scoped(input, () => assert.equal(state.getFlowState(WA_ID), null));
});

test('main generates a separate reply for identical messages from different contacts', async () => {
  const first = fixture('tenant-a', 'conv-a', WA_ID, 'first');
  const second = fixture('tenant-a', 'conv-b', '593000000002', 'second');
  await bot.handleInboundMessage(first);
  await bot.handleInboundMessage(second);
  assert.equal(aiCalls.length, 2);
  assert.deepEqual(sent.map((item) => item.body), ['reply-fixture-first', 'reply-fixture-second']);
  assert.deepEqual(aiCalls[1].context.history.map((item) => item.content), ['history-second', second.incoming.text.body]);
});

test('an explicit request to talk to a therapist still escalates during staff selection', async () => {
  const input = fixture('tenant-a', 'conv');
  input.conv.botState = {
    flow: 'booking',
    booking: {
      step: 'select_staff', serviceId: 'fixture-service', timeSlot: '2099-08-01T15:00:00.000Z',
      availableStaff: [{ id: 'fixture-staff', name: 'Gianella', jobTitle: 'Terapeuta' }],
    },
  };
  input.incoming.text.body = 'quiero hablar con Gianella';
  prisma.tenant = { findUnique: async () => ({ config: {
    workDays: [1, 2, 3, 4, 5, 6, 7], businessHours: { start: '00:00', end: '23:59' },
  } }) };
  await bot.handleInboundMessage(input);
  assert.equal(aiCalls.length, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /conecto con un asesor/i);
  scoped(input, () => {
    assert.equal(state.isEscalated(WA_ID), true);
    assert.equal(state.getFlowState(WA_ID), null);
  });
  assert.equal(updates.at(-1).data.botState, null);
});
