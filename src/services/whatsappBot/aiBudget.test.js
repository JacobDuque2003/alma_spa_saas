const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../../utils/prisma');
const { budgetDayStart, dailyCap } = require('./aiBudget');
test('AI budget uses midnight in Guayaquil independently of host timezone', () => {
  assert.match(budgetDayStart().toISOString(), /T05:00:00.000Z/);
});
test('budget rejects unsafe caps and accepts zero or a tenant override', () => {
  assert.equal(dailyCap({ almitaDailyAiCapUsd: -1 }), 0.50);
  assert.equal(dailyCap({ almitaDailyAiCapUsd: 0 }), 0);
  assert.equal(dailyCap({ almitaDailyAiCapUsd: 0.25 }), 0.25);
});
