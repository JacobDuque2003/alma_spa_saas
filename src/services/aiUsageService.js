const prisma = require('../utils/prisma');

async function recordAttempt(tenantId, data) {
  if (!tenantId) return true; // Legacy callers without accounting context; production callers supply the tenant.
  const safe = { requestId: data.requestId, attempt: data.attempt, source: data.source === 'simulator' ? 'simulator' : 'whatsapp' };
  for (const field of ['model', 'inputTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens', 'outputTokens', 'cacheTtl', 'usageKnown', 'success', 'errorCode', 'costUsd', 'latencyMs']) {
    if (data[field] !== undefined) safe[field] = data[field];
  }
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

module.exports = { recordAttempt };
