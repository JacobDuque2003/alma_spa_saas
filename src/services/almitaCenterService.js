const prisma = require('../utils/prisma');
const aiClient = require('./aiClient');
const { AppError, BadRequestError } = require('../utils/errors');

const DEFAULT_TENANT_SLUG = 'alma-spa';
const CONFIG_FIELDS = ['personality', 'instructions', 'dailyBriefing', 'active'];
const KNOWLEDGE_FIELDS = ['category', 'title', 'content', 'active', 'priority', 'source'];
const EXAMPLE_FIELDS = ['userMessage', 'expectedIntent', 'expectedReply', 'active'];

function assertSuperadmin(actor) {
  if (actor?.role !== 'superadmin') throw new AppError('Solo superadmin puede acceder al Centro de Almita', 403);
}

function assertPlainObject(value, label = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError(`${label} debe ser un objeto`);
  }
}

function assertAllowedFields(data, allowed) {
  const unknown = Object.keys(data).filter((key) => !allowed.includes(key) && key !== 'tenantId');
  if (unknown.length) throw new BadRequestError(`Campos no permitidos: ${unknown.join(', ')}`);
}

function cleanString(value, field, { min = 1, max, optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string') throw new BadRequestError(`${field} debe ser texto`);
  const cleaned = value.replace(/\0/g, '').trim();
  if (cleaned.length < min) throw new BadRequestError(`${field} debe tener al menos ${min} caracteres`);
  if (cleaned.length > max) throw new BadRequestError(`${field} no puede superar ${max} caracteres`);
  return cleaned;
}

function cleanBoolean(value, field, optional = false) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'boolean') throw new BadRequestError(`${field} debe ser booleano`);
  return value;
}

function cleanPriority(value, optional = false) {
  if (value === undefined && optional) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new BadRequestError('priority debe ser un entero entre 0 y 100');
  }
  return value;
}

function validateConfiguration(data, partial = false) {
  assertPlainObject(data);
  assertAllowedFields(data, CONFIG_FIELDS);
  const result = {};
  for (const [field, max] of [['personality', 5000], ['instructions', 12000], ['dailyBriefing', 5000]]) {
    const value = cleanString(data[field], field, { max, optional: partial });
    if (value !== undefined) result[field] = value;
  }
  const active = cleanBoolean(data.active, 'active', true);
  if (active !== undefined) result.active = active;
  if (partial && !Object.keys(result).length) throw new BadRequestError('Debe enviar al menos un campo de configuración');
  return result;
}

function validateKnowledge(data, partial = false) {
  assertPlainObject(data);
  assertAllowedFields(data, KNOWLEDGE_FIELDS);
  const result = {};
  const specs = { category: 80, title: 180, content: 12000, source: 500 };
  for (const [field, max] of Object.entries(specs)) {
    const value = cleanString(data[field], field, { max, optional: partial });
    if (value !== undefined) result[field] = value;
  }
  const active = cleanBoolean(data.active, 'active', true);
  const priority = cleanPriority(data.priority, true);
  if (active !== undefined) result.active = active;
  if (priority !== undefined) result.priority = priority;
  if (partial && !Object.keys(result).length) throw new BadRequestError('Debe enviar al menos un campo de conocimiento');
  return result;
}

function validateExample(data, partial = false) {
  assertPlainObject(data);
  assertAllowedFields(data, EXAMPLE_FIELDS);
  const result = {};
  const specs = { userMessage: 2000, expectedIntent: 80, expectedReply: 4000 };
  for (const [field, max] of Object.entries(specs)) {
    const value = cleanString(data[field], field, { max, optional: partial });
    if (value !== undefined) result[field] = value;
  }
  if (result.expectedIntent && !aiClient.CHAT_INTENTS.includes(result.expectedIntent)) {
    throw new BadRequestError(`expectedIntent debe ser una intención válida: ${aiClient.CHAT_INTENTS.join(', ')}`);
  }
  const active = cleanBoolean(data.active, 'active', true);
  if (active !== undefined) result.active = active;
  if (partial && !Object.keys(result).length) throw new BadRequestError('Debe enviar al menos un campo del ejemplo');
  return result;
}

async function resolveTenant(actor, requestedTenantId) {
  assertSuperadmin(actor);
  if (requestedTenantId !== undefined && (typeof requestedTenantId !== 'string' || !requestedTenantId.trim())) {
    throw new BadRequestError('tenantId debe ser texto no vacío');
  }
  const tenant = requestedTenantId
    ? await prisma.tenant.findUnique({ where: { id: requestedTenantId.trim() }, select: { id: true, slug: true, name: true } })
    : await prisma.tenant.findUnique({ where: { slug: DEFAULT_TENANT_SLUG }, select: { id: true, slug: true, name: true } });
  if (!tenant) throw new AppError('Tenant no encontrado', 404);
  return tenant;
}

async function listConfigurations(actor, tenantId) {
  const tenant = await resolveTenant(actor, tenantId);
  const configurations = await prisma.almitaConfiguration.findMany({
    where: { tenantId: tenant.id },
    orderBy: { version: 'desc' },
    take: 100,
  });
  return { tenant, configurations };
}

async function getActiveConfiguration(actor, tenantId) {
  const tenant = await resolveTenant(actor, tenantId);
  const configuration = await prisma.almitaConfiguration.findFirst({
    where: { tenantId: tenant.id, active: true },
    orderBy: { version: 'desc' },
  });
  return { tenant, configuration };
}

async function createConfiguration(actor, requestedTenantId, body) {
  const tenant = await resolveTenant(actor, requestedTenantId);
  const data = validateConfiguration(body);
  return prisma.$transaction(async (tx) => {
    const latest = await tx.almitaConfiguration.findFirst({
      where: { tenantId: tenant.id }, select: { version: true }, orderBy: { version: 'desc' },
    });
    if (data.active !== false) {
      await tx.almitaConfiguration.updateMany({ where: { tenantId: tenant.id, active: true }, data: { active: false } });
    }
    return tx.almitaConfiguration.create({
      data: { ...data, active: data.active !== false, tenantId: tenant.id, version: (latest?.version || 0) + 1, createdById: actor.id },
    });
  });
}

async function updateConfiguration(actor, requestedTenantId, id, body) {
  const tenant = await resolveTenant(actor, requestedTenantId);
  const changes = validateConfiguration(body, true);
  const current = await prisma.almitaConfiguration.findFirst({ where: { id, tenantId: tenant.id } });
  if (!current) throw new AppError('Configuración no encontrada', 404);
  const next = {
    personality: changes.personality ?? current.personality,
    instructions: changes.instructions ?? current.instructions,
    dailyBriefing: changes.dailyBriefing ?? current.dailyBriefing,
    active: changes.active ?? true,
  };
  return createConfiguration(actor, tenant.id, next);
}

async function deleteConfiguration(actor, requestedTenantId, id) {
  const tenant = await resolveTenant(actor, requestedTenantId);
  const row = await prisma.almitaConfiguration.findFirst({ where: { id, tenantId: tenant.id } });
  if (!row) throw new AppError('Configuración no encontrada', 404);
  if (row.active) throw new AppError('No se puede eliminar la configuración activa', 409);
  await prisma.almitaConfiguration.delete({ where: { id } });
}

function listEntity(modelName, actor, tenantId, query = {}) {
  return resolveTenant(actor, tenantId).then(async (tenant) => {
    const where = { tenantId: tenant.id };
    if (query.active !== undefined) {
      if (!['true', 'false'].includes(String(query.active))) throw new BadRequestError('active debe ser true o false');
      where.active = String(query.active) === 'true';
    }
    if (modelName === 'almitaKnowledge' && query.category) where.category = cleanString(query.category, 'category', { max: 80 });
    const rows = await prisma[modelName].findMany({ where, orderBy: modelName === 'almitaKnowledge' ? [{ priority: 'desc' }, { updatedAt: 'desc' }] : { updatedAt: 'desc' }, take: 250 });
    return { tenant, rows };
  });
}

async function createEntity(modelName, actor, tenantId, body, validator) {
  const tenant = await resolveTenant(actor, tenantId);
  const data = validator(body);
  return prisma[modelName].create({ data: { ...data, tenantId: tenant.id } });
}

async function updateEntity(modelName, actor, tenantId, id, body, validator) {
  const tenant = await resolveTenant(actor, tenantId);
  const existing = await prisma[modelName].findFirst({ where: { id, tenantId: tenant.id }, select: { id: true } });
  if (!existing) throw new AppError('Registro no encontrado', 404);
  return prisma[modelName].update({ where: { id }, data: validator(body, true) });
}

async function deleteEntity(modelName, actor, tenantId, id) {
  const tenant = await resolveTenant(actor, tenantId);
  const existing = await prisma[modelName].findFirst({ where: { id, tenantId: tenant.id }, select: { id: true } });
  if (!existing) throw new AppError('Registro no encontrado', 404);
  await prisma[modelName].delete({ where: { id } });
}

function normalizeSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function relevanceScore(message, row) {
  const terms = new Set(normalizeSearch(message).split(' ').filter((term) => term.length >= 3));
  const searchable = normalizeSearch(`${row.category} ${row.title} ${row.content}`);
  let overlap = 0;
  for (const term of terms) if (searchable.includes(term)) overlap += 1;
  return overlap * 1000 + Number(row.priority || 0);
}

async function loadSimulationContext(tenantId, message) {
  const [configuration, knowledgeRows, exampleRows, services] = await Promise.all([
    prisma.almitaConfiguration.findFirst({ where: { tenantId, active: true }, orderBy: { version: 'desc' } }),
    prisma.almitaKnowledge.findMany({ where: { tenantId, active: true }, orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }], take: 250 }),
    prisma.almitaApprovedExample.findMany({ where: { tenantId, active: true }, orderBy: { updatedAt: 'desc' }, take: 100 }),
    prisma.service.findMany({
      where: { tenantId, active: true },
      select: { id: true, name: true, category: true, priceUsd: true, durationMins: true, description: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }], take: 150,
    }),
  ]);
  const knowledge = knowledgeRows.map((row) => ({ row, score: relevanceScore(message, row) }))
    .filter(({ score }) => score >= 1000)
    .sort((a, b) => b.score - a.score).slice(0, 6).map(({ row }) => row);
  const examples = exampleRows.map((row) => ({ row, score: relevanceScore(message, { category: row.expectedIntent, title: row.userMessage, content: row.expectedReply }) }))
    .filter(({ score }) => score >= 1000)
    .sort((a, b) => b.score - a.score).slice(0, 4).map(({ row }) => row);
  return { configuration, knowledge, examples, services };
}

async function simulate(actor, requestedTenantId, body) {
  assertPlainObject(body);
  assertAllowedFields(body, ['message', 'tone', 'history']);
  const tenant = await resolveTenant(actor, requestedTenantId);
  const message = cleanString(body.message, 'message', { max: 2000 });
  const tone = body.tone === undefined ? 'usted' : cleanString(body.tone, 'tone', { max: 10 });
  if (!['usted', 'tu'].includes(tone)) throw new BadRequestError('tone debe ser usted o tu');
  const history = body.history === undefined ? [] : body.history;
  if (!Array.isArray(history) || history.length > 16) throw new BadRequestError('history debe contener máximo 16 mensajes');
  const cleanHistory = history.map((entry, index) => {
    assertPlainObject(entry, `history[${index}]`);
    assertAllowedFields(entry, ['role', 'content']);
    if (!['user', 'assistant'].includes(entry.role)) throw new BadRequestError(`history[${index}].role no es válido`);
    return { role: entry.role, content: cleanString(entry.content, `history[${index}].content`, { max: 2000 }) };
  });
  if (!aiClient.isAvailable()) throw new AppError('El proveedor de IA no está configurado', 503);

  const context = await loadSimulationContext(tenant.id, message);
  const startedAt = Date.now();
  const result = await aiClient.chat(message, {
    tone,
    services: context.services,
    history: cleanHistory,
    almitaCenter: context.configuration ? {
      personality: context.configuration.personality,
      instructions: context.configuration.instructions,
      dailyBriefing: context.configuration.dailyBriefing,
      knowledge: context.knowledge,
      examples: context.examples,
    } : { knowledge: context.knowledge, examples: context.examples },
  });
  if (!result.ok) throw new AppError(`No se pudo completar la simulación: ${result.error}`, 502);

  return {
    tenant,
    intent: result.intent,
    reply: result.replyText,
    params: result.params,
    sources: context.knowledge.map(({ id, category, title, source }) => ({ id, category, title, source })),
    configurationVersion: context.configuration?.version || null,
    usage: {
      model: result.model,
      promptTokens: result.inputTokens,
      completionTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      costUsd: result.costUsd,
      latencyMs: Date.now() - startedAt,
    },
  };
}

function parseMetricDate(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)) throw new BadRequestError(`${field} no es una fecha válida`);
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) throw new BadRequestError(`${field} no es una fecha válida`);
  return date;
}

async function getMetrics(actor, requestedTenantId, query = {}) {
  const tenant = await resolveTenant(actor, requestedTenantId);
  const from = parseMetricDate(query.from, 'from');
  const to = parseMetricDate(query.to, 'to');
  if (from && to && from > to) throw new BadRequestError('from no puede ser posterior a to');
  const where = { tenantId: tenant.id };
  if (from || to) where.createdAt = { ...(from && { gte: from }), ...(to && { lte: to }) };
  const [totals, byIntent] = await Promise.all([
    prisma.botInteractionLog.aggregate({
      where,
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, costUsd: true, latencyMs: true },
    }),
    prisma.botInteractionLog.groupBy({ by: ['detectedIntent'], where, _count: { _all: true }, orderBy: { _count: { detectedIntent: 'desc' } } }),
  ]);
  const interactions = totals._count?._all || 0;
  return {
    tenant,
    period: { from: from?.toISOString() || null, to: to?.toISOString() || null },
    interactions,
    promptTokens: totals._sum.promptTokens || 0,
    completionTokens: totals._sum.completionTokens || 0,
    totalTokens: totals._sum.totalTokens || 0,
    costUsd: Number(totals._sum.costUsd || 0),
    averageLatencyMs: interactions ? Math.round((totals._sum.latencyMs || 0) / interactions) : 0,
    byIntent: byIntent.map((row) => ({ intent: row.detectedIntent || 'sin_clasificar', count: row._count._all })),
  };
}

module.exports = {
  listConfigurations, getActiveConfiguration, createConfiguration, updateConfiguration, deleteConfiguration,
  listKnowledge: (actor, tenantId, query) => listEntity('almitaKnowledge', actor, tenantId, query),
  createKnowledge: (actor, tenantId, body) => createEntity('almitaKnowledge', actor, tenantId, body, validateKnowledge),
  updateKnowledge: (actor, tenantId, id, body) => updateEntity('almitaKnowledge', actor, tenantId, id, body, validateKnowledge),
  deleteKnowledge: (actor, tenantId, id) => deleteEntity('almitaKnowledge', actor, tenantId, id),
  listExamples: (actor, tenantId, query) => listEntity('almitaApprovedExample', actor, tenantId, query),
  createExample: (actor, tenantId, body) => createEntity('almitaApprovedExample', actor, tenantId, body, validateExample),
  updateExample: (actor, tenantId, id, body) => updateEntity('almitaApprovedExample', actor, tenantId, id, body, validateExample),
  deleteExample: (actor, tenantId, id) => deleteEntity('almitaApprovedExample', actor, tenantId, id),
  simulate, getMetrics,
  loadRuntimeContext: loadSimulationContext,
  normalizeSearch,
  _internals: { validateConfiguration, validateKnowledge, validateExample, relevanceScore },
};
