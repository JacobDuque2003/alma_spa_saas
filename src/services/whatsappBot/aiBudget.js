const { DateTime } = require('luxon');
function dailyCap(config = {}) {
  const value = Number(config.almitaDailyAiCapUsd ?? process.env.TENANT_DAILY_AI_CAP_USD ?? 0.50);
  return Number.isFinite(value) && value >= 0 ? value : 0.50;
}
function budgetDayStart() { return DateTime.now().setZone('America/Guayaquil').startOf('day').toJSDate(); }
module.exports = { budgetDayStart, dailyCap };
