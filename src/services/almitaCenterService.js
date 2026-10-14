const prisma = require('../utils/prisma');
const aiClient = require('./aiClient');
const publicDataCache = require('./whatsappBot/publicDataCache');
const intentCache = require('./whatsappBot/intentCache');
const { normalizeText } = require('./whatsappBot/textNormalize');
const { readOnlyReply } = require('./whatsappBot/simulationReadOnly');
const { guardReply } = require('./whatsappBot/replySafety');
const { AppError, BadRequestError } = require('../utils/errors');
const { customerServiceWhere, isCustomerService } = require('../utils/customerServicePolicy');
const { isReceptionRequest } = require('../utils/advisorRequest');
const { formatSchedule } = require('../utils/businessHours');
const menus = require('./whatsappBot/menus');

const DEFAULT_TENANT_SLUG = 'alma-spa';
const CONFIG_FIELDS = ['personality', 'instructions', 'dailyBriefing', 'active'];
const KNOWLEDGE_FIELDS = ['category', 'title', 'content', 'active', 'priority', 'source', 'audience'];
const EXAMPLE_FIELDS = ['userMessage', 'expectedIntent', 'expectedReply', 'active', 'audience'];

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

function cleanAudience(value, partial = false) {
  if (value === undefined) return partial ? undefined : 'INTERNAL';
  if (!['PUBLIC', 'INTERNAL'].includes(value)) {
    throw new BadRequestError('audience debe ser PUBLIC o INTERNAL');
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
  const audience = cleanAudience(data.audience, partial);
  if (audience !== undefined) result.audience = audience;
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
  const audience = cleanAudience(data.audience, partial);
  if (audience !== undefined) result.audience = audience;
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
  const result = await prisma.$transaction(async (tx) => {
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
  publicDataCache.invalidate(tenant.id);
  return result;
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
    if (query.audience !== undefined) where.audience = cleanAudience(query.audience);
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
  const result = await prisma[modelName].create({ data: { ...data, tenantId: tenant.id } });
  publicDataCache.invalidate(tenant.id);
  return result;
}

async function updateEntity(modelName, actor, tenantId, id, body, validator) {
  const tenant = await resolveTenant(actor, tenantId);
  const existing = await prisma[modelName].findFirst({ where: { id, tenantId: tenant.id }, select: { id: true } });
  if (!existing) throw new AppError('Registro no encontrado', 404);
  const result = await prisma[modelName].update({ where: { id }, data: validator(body, true) });
  publicDataCache.invalidate(tenant.id);
  return result;
}

async function deleteEntity(modelName, actor, tenantId, id) {
  const tenant = await resolveTenant(actor, tenantId);
  const existing = await prisma[modelName].findFirst({ where: { id, tenantId: tenant.id }, select: { id: true } });
  if (!existing) throw new AppError('Registro no encontrado', 404);
  await prisma[modelName].delete({ where: { id } });
  publicDataCache.invalidate(tenant.id);
}

function normalizeSearch(value) {
  return normalizeText(value);
}

function relevanceScore(message, row) {
  const ignored = new Set('que como cual cuando donde cuanto cuantos quiero quisiera necesito deseo prefiero favor gracias hola para por del los las una unos unas ese esa este esta eso esto servicio servicios trata informacion tienes tienen disponible disponibles fechas dia dias'.split(' '));
  const singular = (term) => term.length > 4 ? term.replace(/s$/, '') : term;
  const terms = new Set(normalizeSearch(message).split(' ').filter((term) => term.length >= 3 && !ignored.has(term)).map(singular));
  const searchable = new Set(normalizeSearch(row.title || row.category ? `${row.category || ''} ${row.title || ''}` : row.content).split(' ').map(singular));
  let overlap = 0;
  for (const term of terms) if (searchable.has(term)) overlap += 1;
  return overlap * 1000 + Number(row.priority || 0);
}

async function loadSimulationContext(tenantId, message, history = []) {
  const [editorial, services, tenant] = await Promise.all([
    publicDataCache.load(tenantId, () => Promise.all([
    prisma.almitaConfiguration.findFirst({ where: { tenantId, active: true }, orderBy: { version: 'desc' } }),
    prisma.almitaKnowledge.findMany({ where: { tenantId, active: true, audience: 'PUBLIC' }, orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }], take: 250 }),
    prisma.almitaApprovedExample.findMany({ where: { tenantId, active: true, audience: 'PUBLIC' }, orderBy: { updatedAt: 'desc' }, take: 100 }),
    ])),
    prisma.service.findMany({
      where: customerServiceWhere(tenantId),
      select: { id: true, name: true, category: true, active: true, priceUsd: true, durationMins: true, description: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }], take: 150,
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { config: true } }),
  ]);
  const [configuration, knowledgeRows, exampleRows] = editorial;
  const lookupText = /\b(ese|este|eso|fechas|disponible|disponibles)\b/.test(normalizeSearch(message))
    ? `${history.filter((entry) => entry.role === 'user').slice(-3).map((entry) => entry.content).join(' ')} ${message}`
    : message;
  const knowledge = knowledgeRows.filter((row) => row.audience === 'PUBLIC' && row.active === true)
    .map((row) => ({ row, score: relevanceScore(lookupText, row) }))
    .filter(({ score }) => score >= 1000)
    .sort((a, b) => b.score - a.score).slice(0, 3).map(({ row }) => row);
  for (const row of knowledgeRows.filter((row) => row.audience === 'PUBLIC' && row.active === true
    && /^(politicas?|politica general|ubicacion|horarios?)$/.test(normalizeSearch(row.category)))) {
    if (!knowledge.some((item) => item.id === row.id)) knowledge.push(row);
  }
  const examples = exampleRows.filter((row) => row.audience === 'PUBLIC' && row.active === true)
    .map((row) => ({ row, score: relevanceScore(message, { category: row.expectedIntent, title: row.userMessage, content: row.expectedReply }) }))
    .filter(({ score }) => score >= 1000)
    .sort((a, b) => b.score - a.score).slice(0, 4).map(({ row }) => row);
  return { configuration, knowledge, examples, services: services.filter(isCustomerService), tenantConfig: tenant?.config || {} };
}

function simulationRule(message, tone, config) {
  const text = normalizeSearch(message);
  if (isReceptionRequest(message)) return {
    intent: 'escalate', reply: 'Un asesor puede ayudarle. En esta simulación no se envían avisos ni se transfiere la conversación.',
  };
  if (/^(hola+|ola+|buenas|buenos dias|buenas tardes|buenas noches)$/.test(text)) return {
    intent: 'greeting', reply: menus.mainMenuText({ tone }),
  };
  if (/\b(horario|hora abren|hora atienden|hora cierran)\b/.test(text)) return { intent: 'business_hours', reply: formatSchedule(config) };
  if (/^(ok gracias|listo gracias|gracias|adios|hasta luego|chao)$/.test(text)) return { intent: 'farewell', reply: 'Con mucho gusto.' };
  const days = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
  const requested = text.replace(/^(el |para el |este |el proximo )/, '');
  const day = days.indexOf(requested);
  const workDays = config?.workDays;
  if (day >= 0 && Array.isArray(workDays) && workDays.every((value) => Number.isInteger(value) && value >= 0 && value <= 7)
    && !workDays.map((value) => value === 0 ? 7 : value).includes(day + 1)) return {
    intent: 'business_hours', reply: `Ese día no hay atención. ${formatSchedule(config)} ¿Qué día de atención prefiere?`,
  };
  return null;
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
  // Older panels included the current message in history as well as in message.
  if (cleanHistory.at(-1)?.role === 'user' && cleanHistory.at(-1).content === message) cleanHistory.pop();
  const context = await loadSimulationContext(tenant.id, message, cleanHistory);
  let rule = simulationRule(message, tone, context.tenantConfig);
  if (!rule) {
    try { rule = await readOnlyReply({ tenantId: tenant.id, ...context, message, history: cleanHistory }); }
    catch { throw new AppError('No se pudo consultar la disponibilidad. Reintente o contacte a un asesor; no se creó ninguna cita.', 503); }
  }
  if (rule) return {
    tenant, ...rule, params: rule.params || {}, handler: 'Reglas', sources: [],
    configurationVersion: context.configuration?.version || null,
    usage: { model: null, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, latencyMs: 0 },
  };
  if (!aiClient.isAvailable()) throw new AppError('El proveedor de IA no está configurado', 503);
  const startedAt = Date.now();
  const result = await aiClient.chat(message, {
    tenantId: tenant.id,
    source: 'simulator',
    tone,
    tenantConfig: context.tenantConfig,
    services: context.services,
    selectedServiceId: context.services.find((service) => normalizeSearch(message).includes(normalizeSearch(service.name)))?.id,
    history: cleanHistory,
    almitaCenter: context.configuration ? {
      personality: context.configuration.personality,
      instructions: context.configuration.instructions,
      dailyBriefing: context.configuration.dailyBriefing,
      knowledge: context.knowledge,
      examples: context.examples,
    } : { knowledge: context.knowledge, examples: context.examples },
  });
  if (!result.ok) {
    const failure = aiClient.simulationError(result.error);
    console.warn('[ALMITA-SIMULATION]', { tenantId: tenant.id, code: failure.code });
    throw new AppError(failure.message, failure.status);
  }

  return {
    tenant,
    intent: result.intent,
    reply: guardReply(result.replyText),
    params: result.params,
    handler: 'IA',
    sources: [
      ...context.knowledge.map(({ id, category, title, source }) => ({ id, category, title, source })),
      ...context.services.filter((item) => {
        const name = normalizeSearch(item.name).split(' ').map((word) => word.replace(/s$/, '')).join(' ');
        const query = normalizeSearch(result.params?.service_query).split(' ').map((word) => word.replace(/s$/, '')).join(' ');
        return name && query && name === query;
      }).map(({ id, name, category }) => ({ id, title: name, category, source: 'Catálogo de servicios' })),
    ],
    configurationVersion: context.configuration?.version || null,
    usage: {
      model: result.model,
      promptTokens: result.inputTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens || 0,
      cacheReadInputTokens: result.cacheReadInputTokens || 0,
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
    intentCache: intentCache.metrics(tenant.id),
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
  _internals: { validateConfiguration, validateKnowledge, validateExample, relevanceScore, simulationRule },
};
