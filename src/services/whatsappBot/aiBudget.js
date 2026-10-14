const { DateTime } = require('luxon');
const prisma = require('../../utils/prisma');
function dailyCap(config = {}) {
  const value = Number(config.almitaDailyAiCapUsd ?? process.env.TENANT_DAILY_AI_CAP_USD ?? 0.50);
  return Number.isFinite(value) && value >= 0 ? value : 0.50;
}
async function canUseAi(tenantId, config) {
  if (!tenantId) return true;
  const start = DateTime.now().setZone('America/Guayaquil').startOf('day').toJSDate();
  try {
    const where = { tenantId, createdAt: { gte: start } };
    const [known, unknown] = await Promise.all([
      prisma.aiUsageLog.aggregate({ where: { ...where, usageKnown: true }, _sum: { costUsd: true } }),
      prisma.aiUsageLog.count({ where: { ...where, usageKnown: false } }),
    ]);
    // Unknown attempts may have been billed; never assume transport failures are free.
    return Number(known._sum.costUsd || 0) + unknown * 0.10 < dailyCap(config);
  } catch {
    console.warn('[AI-BUDGET] No se pudo verificar el presupuesto');
    return false;
  }
}
module.exports = { canUseAi, dailyCap };
