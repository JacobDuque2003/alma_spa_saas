const { DateTime } = require('luxon');
const prisma = require('../utils/prisma');
const aiClient = require('./aiClient');
const { getTenantTimezone } = require('../utils/timezone');

const SERVICE_BOOT_TIME = new Date().toISOString();

function hasEnv(name) {
  return Boolean(process.env[name] && String(process.env[name]).trim() !== '');
}

function safeDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function serializeMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    createdAt: safeDate(row.createdAt),
    direction: row.direction,
    senderType: row.senderType,
    type: row.type,
    status: row.status,
    body: row.body ? String(row.body).slice(0, 220) : null,
    errorCode: row.errorCode || null,
    errorTitle: row.errorTitle || null,
  };
}

function todayBounds(timezone) {
  const now = DateTime.now().setZone(timezone);
  const start = now.startOf('day').toUTC().toJSDate();
  const end = now.plus({ days: 1 }).startOf('day').toUTC().toJSDate();
  return { start, end };
}

function inferWebhookStatus(lastInboundAt) {
  if (!lastInboundAt) return 'unknown';
  const ageMs = Date.now() - new Date(lastInboundAt).getTime();
  if (ageMs <= 24 * 60 * 60 * 1000) return 'active';
  if (ageMs <= 7 * 24 * 60 * 60 * 1000) return 'stale';
  return 'inactive';
}

function overallFromChecks(checks) {
  if (checks.some((c) => c.status === 'error')) return 'error';
  if (checks.some((c) => c.status === 'warning')) return 'warning';
  return 'ok';
}

async function resolveTenantId(actor, requestedTenantId) {
  if (actor.role !== 'superadmin') return actor.tenantId;
  if (requestedTenantId) return requestedTenantId;
  const first = await prisma.tenant.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return first?.id || null;
}

async function getDatabaseStatus() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { connected: true, status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { connected: false, status: 'error', latencyMs: Date.now() - startedAt, error: 'No se pudo conectar a la base de datos' };
  }
}

async function getSystemStatus(actor, { tenantId: requestedTenantId } = {}) {
  const tenantId = await resolveTenantId(actor, requestedTenantId);
  const [tenant, database] = await Promise.all([
    tenantId
      ? prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, slug: true, config: true } })
      : Promise.resolve(null),
    getDatabaseStatus(),
  ]);

  const effectiveTenantId = tenant?.id || tenantId;
  const timezone = getTenantTimezone(tenant?.config);
  const day = todayBounds(timezone);

  const [
    whatsappConnection,
    lastInbound,
    lastBotReply,
    recentMetaErrors,
    aiCost,
    aiCount,
  ] = effectiveTenantId ? await Promise.all([
    prisma.whatsAppConnection.findUnique({
      where: { tenantId: effectiveTenantId },
      select: {
        connectedAt: true,
        displayPhone: true,
        lastError: true,
        lastVerifiedAt: true,
        phoneNumberId: true,
        status: true,
        wabaId: true,
      },
    }),
    prisma.whatsAppMessage.findFirst({
      where: { tenantId: effectiveTenantId, direction: 'inbound' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, direction: true, senderType: true, type: true, status: true, body: true, errorCode: true, errorTitle: true },
    }),
    prisma.whatsAppMessage.findFirst({
      where: { tenantId: effectiveTenantId, direction: 'outbound', senderType: 'bot' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, direction: true, senderType: true, type: true, status: true, body: true, errorCode: true, errorTitle: true },
    }),
    prisma.whatsAppMessage.findMany({
      where: {
        tenantId: effectiveTenantId,
        direction: 'outbound',
        OR: [
          { status: 'failed' },
          { errorCode: { not: null } },
          { errorTitle: { not: null } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, createdAt: true, direction: true, senderType: true, type: true, status: true, body: true, errorCode: true, errorTitle: true },
    }),
    prisma.botInteractionLog.aggregate({
      where: { tenantId: effectiveTenantId, createdAt: { gte: day.start, lt: day.end } },
      _sum: { costUsd: true },
    }),
    prisma.botInteractionLog.count({
      where: { tenantId: effectiveTenantId, createdAt: { gte: day.start, lt: day.end } },
    }),
  ]) : [null, null, null, [], { _sum: { costUsd: 0 } }, 0];

  const webhookStatus = inferWebhookStatus(lastInbound?.createdAt);
  const whatsappStatus = whatsappConnection?.status === 'activo' ? 'ok' : whatsappConnection ? 'warning' : 'warning';
  const metaErrorStatus = recentMetaErrors.length ? 'warning' : 'ok';
  const aiConfigured = aiClient.isAvailable();
  const backupConfigured = hasEnv('GCS_BUCKET') && hasEnv('GCS_SERVICE_ACCOUNT_KEY') && hasEnv('DATABASE_URL');

  const checks = [
    { key: 'database', status: database.connected ? 'ok' : 'error' },
    { key: 'whatsapp', status: whatsappStatus },
    { key: 'webhook', status: webhookStatus === 'active' ? 'ok' : webhookStatus === 'stale' ? 'warning' : 'warning' },
    { key: 'metaErrors', status: metaErrorStatus },
    { key: 'ai', status: aiConfigured ? 'ok' : 'warning' },
    { key: 'backups', status: backupConfigured ? 'ok' : 'warning' },
  ];

  return {
    generatedAt: new Date().toISOString(),
    tenant: tenant ? { id: tenant.id, name: tenant.name, slug: tenant.slug, timezone } : null,
    overall: overallFromChecks(checks),
    checks,
    whatsapp: {
      connected: Boolean(whatsappConnection),
      status: whatsappConnection?.status || 'desconectado',
      displayPhone: whatsappConnection?.displayPhone || null,
      phoneNumberId: whatsappConnection?.phoneNumberId || null,
      wabaId: whatsappConnection?.wabaId || null,
      connectedAt: safeDate(whatsappConnection?.connectedAt),
      lastVerifiedAt: safeDate(whatsappConnection?.lastVerifiedAt),
      lastError: whatsappConnection?.lastError || null,
    },
    webhook: {
      status: webhookStatus,
      lastInbound: serializeMessage(lastInbound),
    },
    bot: {
      lastReply: serializeMessage(lastBotReply),
    },
    metaErrors: {
      count: recentMetaErrors.length,
      items: recentMetaErrors.map(serializeMessage),
    },
    ai: {
      configured: aiConfigured,
      model: aiClient.MODEL,
      todayCostUsd: Number(aiCost?._sum?.costUsd || 0),
      todayInteractions: aiCount,
      timezone,
    },
    database,
    backups: {
      configured: backupConfigured,
      bucketConfigured: hasEnv('GCS_BUCKET'),
      bucket: hasEnv('GCS_BUCKET') ? process.env.GCS_BUCKET : null,
      serviceAccountConfigured: hasEnv('GCS_SERVICE_ACCOUNT_KEY'),
      databaseUrlConfigured: hasEnv('DATABASE_URL'),
      pgDumpPathConfigured: hasEnv('PG_DUMP_PATH'),
    },
    railway: {
      commit: process.env.RAILWAY_GIT_COMMIT_SHA ? process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7) : 'desconocido',
      nodeEnv: process.env.NODE_ENV || 'development',
      serviceIdConfigured: hasEnv('RAILWAY_SERVICE_ID'),
      environmentIdConfigured: hasEnv('RAILWAY_ENVIRONMENT_ID'),
      deployedAt: SERVICE_BOOT_TIME,
    },
  };
}

module.exports = { getSystemStatus, _internals: { inferWebhookStatus, overallFromChecks } };
