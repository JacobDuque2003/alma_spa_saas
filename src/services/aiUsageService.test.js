const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const usage = require('./aiUsageService');
test('usage ledger whitelists fields and cannot override tenant or retain messages', async (t) => {
  let write;
  const original = prisma.aiUsageLog;
  prisma.aiUsageLog = { upsert: async (args) => { write = args; } };
  t.after(() => { prisma.aiUsageLog = original; });
  assert.equal(await usage.recordAttempt('one', { tenantId: 'other', requestId: 'opaque', attempt: 1, source: 'simulator',
    body: 'PRIVATE', phone: 'PRIVATE', cacheCreationInputTokens: 5000, cacheReadInputTokens: 0, errorCode: 'AI_FORMAT', costUsd: 0.01 }), true);
  assert.equal(write.create.tenantId, 'one');
  assert.equal(write.where.tenantId_requestId_attempt.attempt, 1);
  assert.doesNotMatch(JSON.stringify(write), /PRIVATE|other/);
});
test('ledger failure is observable without logging provider content', async (t) => {
  const original = prisma.aiUsageLog;
  prisma.aiUsageLog = { upsert: async () => { throw Error('PRIVATE'); } };
  t.after(() => { prisma.aiUsageLog = original; });
  assert.equal(await usage.recordAttempt('one', { requestId: 'opaque', attempt: 0 }), false);
});

test('budget reservation is checked and inserted under the same database lock', async (t) => {
  const original = prisma.$transaction;
  const rows = [];
  let tail = Promise.resolve();
  prisma.$transaction = async (callback) => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await callback({
        $executeRaw: async (strings) => { assert.match(strings.join(''), /pg_advisory_xact_lock/); },
        aiUsageLog: { aggregate: async () => ({ _sum: { costUsd: 0.49, reservedCostUsd: rows.reduce((sum, row) => sum + row.reservedCostUsd, 0) } }),
          create: async ({ data }) => { rows.push(data); } },
      });
    } finally { release(); }
  };
  t.after(() => { prisma.$transaction = original; });
  const decisions = await Promise.all(Array.from({ length: 10 }, (_, attempt) => usage.reserveAttempt('one',
    { requestId: `request-${attempt}`, attempt: 0, source: 'simulator' }, { max_tokens: 350 }, { almitaDailyAiCapUsd: 0.5 })));
  assert.equal(decisions.filter(Boolean).length, 1);
  assert.ok(0.49 + rows.reduce((sum, row) => sum + row.reservedCostUsd, 0) <= 0.5);
});
