const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../../utils/prisma');
const { canUseAi, dailyCap } = require('./aiBudget');
test('AI budget aggregates all conversations and simulations of one tenant', async (t) => {
  const original = prisma.aiUsageLog;
  const queries = [];
  prisma.aiUsageLog = { aggregate: async ({ where }) => { queries.push(where); return { _sum: { costUsd: 0.45 } }; }, count: async () => 1 };
  t.after(() => { prisma.aiUsageLog = original; });
  assert.equal(await canUseAi('one', { almitaDailyAiCapUsd: 0.50 }), false);
  assert.equal(queries[0].tenantId, 'one');
  assert.equal(queries[0].conversationId, undefined);
  assert.match(queries[0].createdAt.gte.toISOString(), /T05:00:00.000Z/);
});
test('budget rejects unsafe caps and refuses AI when usage storage is unavailable', async (t) => {
  assert.equal(dailyCap({ almitaDailyAiCapUsd: -1 }), 0.50);
  const original = prisma.aiUsageLog;
  prisma.aiUsageLog = { aggregate: async () => { throw Error('offline'); }, count: async () => 0 };
  t.after(() => { prisma.aiUsageLog = original; });
  assert.equal(await canUseAi('one', {}), false);
});
