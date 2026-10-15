const prisma = require('../utils/prisma');
const { chooseTtl } = require('./whatsappBot/cachePolicy');
const { dailyCap, budgetDayStart } = require('./whatsappBot/aiBudget');
function reservationFor(body) {
  // UTF-8 bytes bound text tokens conservatively; budget for cold 1h writes and schema overhead.
  return Math.ceil((Buffer.byteLength(JSON.stringify(body), 'utf8') * 2 / 1000000 + (body.max_tokens || 350) * 5 / 1000000 + 0.005) * 1000000) / 1000000;
}
async function reserveAttempt(tenantId, data, body, config) {
  if (!tenantId) return true;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('almita-ai-budget'), hashtext(${tenantId}))`;
      const start = budgetDayStart();
      const total = await tx.aiUsageLog.aggregate({ where: { tenantId, createdAt: { gte: start } }, _sum: { costUsd: true, reservedCostUsd: true } });
      const reservedCostUsd = reservationFor(body);
      if (Number(total._sum.costUsd || 0) + Number(total._sum.reservedCostUsd || 0) + reservedCostUsd > dailyCap(config)) return false;
      await tx.aiUsageLog.create({ data: { tenantId, requestId: data.requestId, attempt: data.attempt, source: data.source, model: data.model,
        reservedCostUsd, costUsd: null, usageKnown: false, errorCode: 'AI_PENDING' } });
      return true;
    });
  } catch {
    console.warn('[AI-BUDGET] No se pudo reservar presupuesto');
    return false;
  }
}
const policies = new Map();
async function cacheTtl(tenantId) {
  if (!tenantId) return '1h';
  const previous = policies.get(tenantId);
  if (previous?.until > Date.now()) return previous.ttl;
  try {
    const logs = await prisma.aiUsageLog.findMany({ where: { tenantId, usageKnown: true, success: true },
      orderBy: { createdAt: 'desc' }, take: 120, select: { createdAt: true } });
    const ttl = chooseTtl(logs.map((row) => new Date(row.createdAt).getTime()));
    policies.set(tenantId, { ttl, until: Date.now() + 600000 });
    if (policies.size > 500) policies.delete(policies.keys().next().value);
    return ttl;
  } catch { return '1h'; }
}

async function recordAttempt(tenantId, data) {
  if (!tenantId) return true; // Legacy callers without accounting context; production callers supply the tenant.
  const safe = { requestId: data.requestId, attempt: data.attempt, source: data.source === 'simulator' ? 'simulator' : 'whatsapp' };
  for (const field of ['model', 'inputTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens', 'outputTokens', 'cacheTtl', 'usageKnown', 'success', 'errorCode', 'costUsd', 'latencyMs']) {
    if (data[field] !== undefined) safe[field] = data[field];
  }
  if (safe.usageKnown === true) safe.reservedCostUsd = 0;
  try {
    await prisma.aiUsageLog.upsert({
      where: { tenantId_requestId_attempt: { tenantId, requestId: safe.requestId, attempt: safe.attempt } },
      create: { ...safe, tenantId }, update: safe,
    });
    return true;
  } catch {
    console.warn('[AI-USAGE] No se pudo registrar el consumo');
    return false;
  }
}

async function metrics(tenantId, period = {}) {
  const where = { tenantId, ...period };
  try {
    const [totals, unknown, bySource] = await Promise.all([
      prisma.aiUsageLog.aggregate({ where, _count: { _all: true }, _sum: { inputTokens: true, cacheCreationInputTokens: true, cacheReadInputTokens: true, outputTokens: true, costUsd: true } }),
      prisma.aiUsageLog.count({ where: { ...where, usageKnown: false } }),
      prisma.aiUsageLog.groupBy({ by: ['source'], where, _count: { _all: true } }),
    ]);
    return { available: true, attempts: totals._count?._all || 0, unknownAttempts: unknown,
      ...totals._sum, costUsd: Number(totals._sum?.costUsd || 0), bySource };
  } catch { return { available: false }; }
}
module.exports = { recordAttempt, reserveAttempt, reservationFor, metrics, cacheTtl };
