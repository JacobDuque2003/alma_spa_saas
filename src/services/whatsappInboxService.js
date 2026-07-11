const prisma = require('../utils/prisma');
const { BadRequestError } = require('../utils/errors');
const { assertTenantScope } = require('../utils/tenantScope');
const transport = require('./whatsappTransport');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TZ_OFFSET_MINUTES = -5 * 60; // America/Guayaquil (UTC-5, sin DST). Fallback si Tenant.config no lo trae.

function isWithinWindow(lastInboundAt) {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS;
}

function previewOf(text) {
  if (!text) return null;
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > 120 ? clean.slice(0, 120) + '…' : clean;
}

/**
 * Devuelve [inicioDiaTz, inicioDiaSiguienteTz) para "hoy" en la zona horaria del
 * tenant. Sargable (rango cerrado→abierto), NO usa DATE()/CURRENT_DATE. Ecuador
 * es UTC-5 fijo (sin DST) por lo que un offset entero alcanza para el piloto.
 */
function todayRangeForTenant(tenantConfig) {
  const cfg = tenantConfig?.whatsapp?.timezoneOffsetMinutes;
  const offset = typeof cfg === 'number' ? cfg : DEFAULT_TZ_OFFSET_MINUTES;
  const nowMs = Date.now();
  const localNow = new Date(nowMs + offset * 60_000);
  const y = localNow.getUTCFullYear();
  const m = localNow.getUTCMonth();
  const d = localNow.getUTCDate();
  const startUtcMs = Date.UTC(y, m, d) - offset * 60_000;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + 86_400_000) };
}

async function loadConversationForActor(actor, conversationId) {
  const conv = await prisma.whatsAppConversation.findUnique({ where: { id: conversationId } });
  if (!conv) return null;
  assertTenantScope(actor, conv.tenantId);
  return conv;
}

/**
 * Bandeja. Filtro sin_confirmar_hoy: prefetch de citas del día en pendiente,
 * luego lookup de conversaciones por clientId — reusa Appointment.status como
 * fuente de verdad, NO duplica un flag "confirmado" en la conversación.
 */
async function listConversations(actor, query) {
  const tenantId = actor.tenantId;
  const limit = Math.min(Number(query.limit) || 30, 100);
  const where = { tenantId };
  if (query.unread === 'true') where.unreadCount = { gt: 0 };
  if (query.q) {
    where.OR = [
      { customerWaId: { contains: String(query.q) } },
      { customerName: { contains: String(query.q), mode: 'insensitive' } },
    ];
  }
  if (query.cursor) {
    const [cursorDate, cursorId] = query.cursor.split('|');
    if (cursorId) {
      where.OR = [
        { lastMessageAt: { lt: new Date(cursorDate) } },
        { lastMessageAt: new Date(cursorDate), id: { lt: cursorId } },
      ];
    } else {
      where.lastMessageAt = { lt: new Date(cursorDate) };
    }
  }

  if (query.filter === 'sin_confirmar_hoy') {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { config: true } });
    const range = todayRangeForTenant(tenant?.config);
    const pending = await prisma.appointment.findMany({
      where: { tenantId, status: 'pendiente', startsAt: { gte: range.start, lt: range.end } },
      select: { clientId: true },
    });
    const clientIds = [...new Set(pending.map((a) => a.clientId))];
    if (clientIds.length === 0) return { items: [], nextCursor: null };
    where.clientId = { in: clientIds };
  }

  const rows = await prisma.whatsAppConversation.findMany({
    where,
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: limit,
    include: { client: { select: { id: true, fullName: true } } },
  });
  const items = rows.map((c) => ({
    id: c.id,
    customerWaId: c.customerWaId,
    customerName: c.customerName,
    clientId: c.clientId,
    clientName: c.client?.fullName ?? null,
    lastMessagePreview: c.lastMessagePreview,
    lastMessageAt: c.lastMessageAt,
    unreadCount: c.unreadCount,
    withinWindow: isWithinWindow(c.lastInboundAt),
  }));
  const last = rows[rows.length - 1];
  const nextCursor = rows.length === limit ? `${last.lastMessageAt.toISOString()}|${last.id}` : null;
  return { items, nextCursor };
}

async function getConversation(actor, conversationId) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  return { ...conv, withinWindow: isWithinWindow(conv.lastInboundAt) };
}

async function listMessages(actor, conversationId, query) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  const limit = Math.min(Number(query.limit) || 50, 200);
  const where = { conversationId: conv.id };
  if (query.cursor) {
    const [cursorDate, cursorId] = query.cursor.split('|');
    if (cursorId) {
      where.OR = [
        { createdAt: { lt: new Date(cursorDate) } },
        { createdAt: new Date(cursorDate), id: { lt: cursorId } },
      ];
    } else {
      where.createdAt = { lt: new Date(cursorDate) };
    }
  }
  const rows = await prisma.whatsAppMessage.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return {
    items: rows.reverse(),
    nextCursor: rows.length === limit ? `${rows[0].createdAt.toISOString()}|${rows[0].id}` : null,
  };
}

async function sendManualText(actor, conversationId, text) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new BadRequestError('body es requerido');
  }
  if (!isWithinWindow(conv.lastInboundAt)) {
    const err = new BadRequestError('WINDOW_CLOSED: pasaron más de 24h desde el último mensaje del cliente. Usá el recordatorio (plantilla).');
    err.status = 422;
    throw err;
  }
  const conn = await transport.loadActiveConnection(conv.tenantId);
  if (!conn) throw new BadRequestError('WhatsApp no está conectado para este tenant');

  const message = await prisma.whatsAppMessage.create({
    data: {
      tenantId: conv.tenantId,
      conversationId: conv.id,
      direction: 'outbound',
      type: 'text',
      status: 'queued',
      body: text,
      sentByUserId: actor.id,
    },
  });

  const send = await transport.sendText(conn, conv.customerWaId, text);
  const finalState = send.ok
    ? { status: 'sent', waMessageId: send.data?.messages?.[0]?.id ?? null }
    : { status: 'failed', errorCode: String(send.errorCode ?? send.status ?? ''), errorTitle: String(send.errorTitle ?? '').slice(0, 250) };

  const updated = await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: finalState,
  });
  const now = new Date();
  await prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: { lastOutboundAt: now, lastMessageAt: now, lastMessagePreview: previewOf(text) },
  });
  return updated;
}

/**
 * Recordatorio de confirmación. SIEMPRE plantilla pre-aprobada — funciona
 * dentro y fuera de la ventana. Precondición server-side: el cliente enlazado
 * tiene una Appointment pendiente futura, y su confirmationToken alimenta el
 * botón CTA de la plantilla (reusa el flujo público de Fase 3a).
 */
async function sendReminder(actor, conversationId) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  if (!conv.clientId) throw new BadRequestError('La conversación no está enlazada a un cliente');

  const nextPending = await prisma.appointment.findFirst({
    where: {
      tenantId: conv.tenantId,
      clientId: conv.clientId,
      status: 'pendiente',
      startsAt: { gte: new Date() },
    },
    orderBy: { startsAt: 'asc' },
    include: { service: { select: { name: true } } },
  });
  if (!nextPending) {
    throw new BadRequestError('El cliente no tiene una cita pendiente para confirmar');
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: conv.tenantId }, select: { config: true } });
  const tpl = tenant?.config?.whatsapp?.confirmationTemplate;
  if (!tpl?.name || !tpl?.language) {
    throw new BadRequestError('El tenant no tiene plantilla de confirmación configurada en Tenant.config.whatsapp.confirmationTemplate');
  }
  const publicBase = process.env.PUBLIC_BASE_URL || tenant?.config?.publicBaseUrl;
  if (!publicBase) {
    throw new BadRequestError('PUBLIC_BASE_URL no está configurada (necesaria para el link del recordatorio)');
  }

  const conn = await transport.loadActiveConnection(conv.tenantId);
  if (!conn) throw new BadRequestError('WhatsApp no está conectado para este tenant');

  const client = await prisma.client.findUnique({ where: { id: conv.clientId }, select: { fullName: true } });
  const startsAtIso = nextPending.startsAt.toISOString();

  // Sanitización: Meta rechaza params con saltos de línea/tabs. Truncar a 60ch.
  const sanitize = (v) => String(v ?? '').replace(/[\n\r\t]+/g, ' ').slice(0, 60);
  const bodyParams = [client?.fullName, nextPending.service.name, startsAtIso].map(sanitize);
  const buttonPath = `bookings/${encodeURIComponent(nextPending.confirmationToken)}/confirm`;

  const message = await prisma.whatsAppMessage.create({
    data: {
      tenantId: conv.tenantId,
      conversationId: conv.id,
      direction: 'outbound',
      type: 'template',
      status: 'queued',
      templateName: tpl.name,
      templateLang: tpl.language,
      sentByUserId: actor.id,
    },
  });

  const send = await transport.sendTemplate(conn, conv.customerWaId, {
    name: tpl.name,
    language: tpl.language,
    components: [
      { type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: buttonPath }] },
    ],
  });
  const finalState = send.ok
    ? { status: 'sent', waMessageId: send.data?.messages?.[0]?.id ?? null }
    : { status: 'failed', errorCode: String(send.errorCode ?? send.status ?? ''), errorTitle: String(send.errorTitle ?? '').slice(0, 250) };
  const updated = await prisma.whatsAppMessage.update({ where: { id: message.id }, data: finalState });

  const now = new Date();
  await prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: { lastOutboundAt: now, lastMessageAt: now, lastMessagePreview: `[Recordatorio] ${nextPending.service.name}` },
  });
  return updated;
}

async function markRead(actor, conversationId) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  return prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: { unreadCount: 0, lastReadAt: new Date() },
  });
}

async function updateConversation(actor, conversationId, changes) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  const data = {};
  if (changes.clientId !== undefined) {
    if (changes.clientId !== null) {
      const client = await prisma.client.findFirst({ where: { id: changes.clientId, tenantId: conv.tenantId } });
      if (!client) throw new BadRequestError('clientId inválido para este tenant');
    }
    data.clientId = changes.clientId;
  }
  if (changes.archived !== undefined) data.archived = !!changes.archived;
  return prisma.whatsAppConversation.update({ where: { id: conv.id }, data });
}

module.exports = {
  listConversations,
  getConversation,
  listMessages,
  sendManualText,
  sendReminder,
  markRead,
  updateConversation,
  isWithinWindow,
  previewOf,
  todayRangeForTenant,
};
