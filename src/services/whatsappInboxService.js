const prisma = require('../utils/prisma');
const { BadRequestError } = require('../utils/errors');
const { assertTenantScope } = require('../utils/tenantScope');
const transport = require('./whatsappTransport');
const botState = require('./whatsappBot/state');
const crmEvents = require('./crmEventBus');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TZ_OFFSET_MINUTES = -5 * 60; // America/Guayaquil (UTC-5, sin DST). Fallback si Tenant.config no lo trae.
const LABEL_TONES = ['blue', 'amber', 'emerald', 'purple', 'red', 'sky', 'rose', 'neutral'];
const DEFAULT_LABELS = [
  { key: 'consulta', text: 'Consulta', tone: 'blue' },
  { key: 'reserva_pendiente', text: 'Reserva pendiente', tone: 'amber' },
  { key: 'cita_confirmada', text: 'Cita confirmada', tone: 'emerald' },
  { key: 'seguimiento', text: 'Seguimiento', tone: 'purple' },
  { key: 'queja', text: 'Queja', tone: 'red' },
  { key: 'nueva_clienta', text: 'Nuevo cliente', tone: 'sky' },
  { key: 'solicitar_recepcionista', text: 'Solicita recepción', tone: 'amber' },
];
const DEFAULT_QUICK_REPLIES = [
  { key: 'saludo', icon: '👋', title: 'Saludo', text: 'Hola, gracias por escribir a Alma Spa. ¿En qué podemos ayudarte?' },
  { key: 'confirmar', icon: '✅', title: 'Confirmar', text: 'Perfecto, tu cita queda confirmada. Te esperamos con mucho gusto.' },
  { key: 'horario', icon: '🕐', title: 'Horario', text: 'Nuestro horario es de lunes a sábado de 9:00 a 19:00.' },
  { key: 'agendar', icon: '💆', title: 'Agendar', text: 'Claro, podemos ayudarte a agendar una cita. ¿Qué día y horario te queda mejor?' },
  { key: 'cumple', icon: '🎂', title: 'Cumple', text: '¡Feliz cumpleaños! En Alma Spa tenemos un detalle especial para ti.' },
];
const MAX_CRM_MEDIA_BYTES = 8 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/webm',
  'video/mp4',
  'video/3gpp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
];

function isWithinWindow(lastInboundAt) {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS;
}

function previewOf(text) {
  if (!text) return null;
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > 120 ? clean.slice(0, 120) + '…' : clean;
}

function sanitizeFilename(name = 'archivo') {
  const clean = String(name || 'archivo')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return clean || 'archivo';
}

function mediaTypeFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

function decodeMediaDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!match) throw new BadRequestError('Archivo inválido');
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MEDIA_TYPES.includes(mimeType)) {
    throw new BadRequestError('Tipo de archivo no permitido para WhatsApp');
  }
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw new BadRequestError('El archivo está vacío');
  if (buffer.length > MAX_CRM_MEDIA_BYTES) {
    throw new BadRequestError('El archivo supera el límite de 8MB');
  }
  return { buffer, mimeType };
}

function bodyFromIncomingMedia(message) {
  if (!message) return null;
  if (message.type === 'text') return message.text?.body ?? null;
  if (message.type === 'image') return message.image?.caption || '[imagen]';
  if (message.type === 'audio') return '[audio]';
  if (message.type === 'video') return message.video?.caption || '[video]';
  if (message.type === 'document') return message.document?.caption || message.document?.filename || '[documento]';
  if (message.type === 'sticker') return '[sticker]';
  if (message.type === 'location') return '[ubicación]';
  if (message.type === 'interactive') {
    return message.interactive?.button_reply?.title
      || message.interactive?.list_reply?.title
      || '[interactivo]';
  }
  return `[${message.type || 'mensaje'}]`;
}

function slugLabel(text, fallback = 'etiqueta') {
  const slug = String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

function normalizeLabelDefinitions(input) {
  const rows = Array.isArray(input) ? input : DEFAULT_LABELS;
  const used = new Set();
  return rows.slice(0, 24).map((row, index) => {
    const text = String(row?.text || '').trim().slice(0, 36) || `Etiqueta ${index + 1}`;
    let key = slugLabel(row?.key || text, `etiqueta_${index + 1}`);
    if (used.has(key)) key = `${key}_${index + 1}`.slice(0, 48);
    used.add(key);
    const tone = LABEL_TONES.includes(row?.tone) ? row.tone : DEFAULT_LABELS[index]?.tone || 'neutral';
    return { key, text, tone };
  });
}

function normalizeQuickReplies(input) {
  const rows = Array.isArray(input) ? input : DEFAULT_QUICK_REPLIES;
  const used = new Set();
  return rows.slice(0, 20).map((row, index) => {
    const title = String(row?.title || '').trim().slice(0, 40) || `Respuesta ${index + 1}`;
    const text = String(row?.text || '').trim().slice(0, 800);
    const icon = Array.from(String(row?.icon || '💬').trim()).slice(0, 2).join('').trim() || '💬';
    let key = slugLabel(row?.key || title, `respuesta_${index + 1}`);
    if (used.has(key)) key = `${key}_${index + 1}`.slice(0, 48);
    used.add(key);
    return {
      key,
      icon,
      title,
      text,
    };
  }).filter((row) => row.text);
}

async function listLabelDefinitions(actor) {
  if (!actor?.tenantId || !prisma.tenant?.findUnique) return DEFAULT_LABELS;
  const tenant = await prisma.tenant.findUnique({
    where: { id: actor.tenantId },
    select: { config: true },
  });
  return normalizeLabelDefinitions(tenant?.config?.crm?.labels);
}

async function saveLabelDefinitions(actor, labels) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: actor.tenantId },
    select: { config: true },
  });
  if (!tenant) throw new BadRequestError('Tenant no encontrado');
  const nextLabels = normalizeLabelDefinitions(labels);
  const existing = tenant.config || {};
  const nextConfig = {
    ...existing,
    crm: {
      ...(existing.crm || {}),
      labels: nextLabels,
    },
  };
  await prisma.tenant.update({
    where: { id: actor.tenantId },
    data: { config: nextConfig },
  });
  publishConversationEvent(actor.tenantId, 'conversation.labels.config.updated', {
    labels: nextLabels,
  });
  return nextLabels;
}

async function listQuickReplies(actor) {
  if (!actor?.tenantId || !prisma.tenant?.findUnique) return DEFAULT_QUICK_REPLIES;
  const tenant = await prisma.tenant.findUnique({
    where: { id: actor.tenantId },
    select: { config: true },
  });
  return normalizeQuickReplies(tenant?.config?.crm?.quickReplies);
}

async function saveQuickReplies(actor, quickReplies) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: actor.tenantId },
    select: { config: true },
  });
  if (!tenant) throw new BadRequestError('Tenant no encontrado');
  const nextQuickReplies = normalizeQuickReplies(quickReplies);
  const existing = tenant.config || {};
  const nextConfig = {
    ...existing,
    crm: {
      ...(existing.crm || {}),
      quickReplies: nextQuickReplies,
    },
  };
  await prisma.tenant.update({
    where: { id: actor.tenantId },
    data: { config: nextConfig },
  });
  publishConversationEvent(actor.tenantId, 'conversation.quick_replies.config.updated', {
    quickReplies: nextQuickReplies,
  });
  return nextQuickReplies;
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
  const conv = await prisma.whatsAppConversation.findUnique({
    where: { id: conversationId },
    include: {
      client: {
        select: {
          id: true,
          recordNumber: true,
          fullName: true,
          whatsapp: true,
          email: true,
          active: true,
          createdAt: true,
        },
      },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });
  if (!conv) return null;
  assertTenantScope(actor, conv.tenantId);
  return conv;
}

function conversationStatusForList(c) {
  if (c.archived) return 'archived';
  if (c.status) return c.status;
  if (c.unreadCount > 0) return 'pending';
  return 'open';
}

function publishConversationEvent(tenantId, event, payload) {
  crmEvents.publish(tenantId, event, {
    tenantId,
    at: new Date().toISOString(),
    ...payload,
  });
}

function compactConversation(c) {
  if (!c) return null;
  let botStatus = c.botActive ? 'active' : 'handedOff';
  if (c.botActive && botState.isEscalated(c.customerWaId)) botStatus = 'escalated';
  const pendingMessageCount = Math.max(Number(c.unreadCount || 0), 0);
  return {
    id: c.id,
    customerWaId: c.customerWaId,
    customerName: c.customerName,
    clientId: c.clientId,
    clientName: c.client?.fullName ?? null,
    client: c.client ?? null,
    lastMessagePreview: c.lastMessagePreview,
    lastMessageAt: c.lastMessageAt,
    unreadCount: c.unreadCount,
    unreadRestoreCount: c.unreadRestoreCount ?? 0,
    pendingMessageCount,
    manuallyMarkedUnread: Boolean(c.manuallyMarkedUnread),
    status: conversationStatusForList(c),
    withinWindow: isWithinWindow(c.lastInboundAt),
    botActive: c.botActive,
    botPausedUntil: c.botPausedUntil ?? null,
    botStatus,
    assignedToUserId: c.assignedToUserId ?? null,
    assignedTo: c.assignedTo ?? null,
    labels: c.labels || [],
    archived: c.archived,
    createdAt: c.createdAt,
  };
}

/**
 * Bandeja. Filtro sin_confirmar_hoy: prefetch de citas del día en pendiente,
 * luego lookup de conversaciones por clientId — reusa Appointment.status como
 * fuente de verdad, NO duplica un flag "confirmado" en la conversación.
 */
async function listConversations(actor, query) {
  const tenantId = actor.tenantId;
  const limit = Math.min(Number(query.limit) || 30, 100);
  const baseWhere = { tenantId };
  if (query.q) {
    const search = String(query.q);
    baseWhere.OR = [
      { customerWaId: { contains: search } },
      { customerName: { contains: search, mode: 'insensitive' } },
      { lastMessagePreview: { contains: search, mode: 'insensitive' } },
      { client: { is: { fullName: { contains: search, mode: 'insensitive' } } } },
      { client: { is: { whatsapp: { contains: search } } } },
      { client: { is: { recordNumber: { contains: search, mode: 'insensitive' } } } },
    ];
  }

  const where = { ...baseWhere };
  if (query.unread === 'true') where.unreadCount = { gt: 0 };
  if (query.status && ['open', 'pending', 'resolved', 'archived'].includes(String(query.status))) {
    where.status = String(query.status) === 'pending'
      ? { in: ['open', 'pending'] }
      : String(query.status);
  } else if (query.includeArchived !== 'true') {
    where.status = { not: 'archived' };
  }
  if (query.cursor) {
    const [cursorDate, cursorId] = query.cursor.split('|');
    if (cursorId) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { lastMessageAt: { lt: new Date(cursorDate) } },
            { lastMessageAt: new Date(cursorDate), id: { lt: cursorId } },
          ],
        },
      ];
    } else {
      where.lastMessageAt = { lt: new Date(cursorDate) };
    }
  }

  if (query.filter === 'bot_active') {
    where.botActive = true;
  } else if (query.filter === 'bot_off') {
    where.botActive = false;
  } else if (query.filter === 'sin_confirmar_hoy') {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { config: true } });
    const range = todayRangeForTenant(tenant?.config);
    const pending = await prisma.appointment.findMany({
      where: { tenantId, status: 'pendiente', startsAt: { gte: range.start, lt: range.end }, client: { is: { active: true } } },
      select: { clientId: true },
    });
    const clientIds = [...new Set(pending.map((a) => a.clientId))];
    if (clientIds.length === 0) return { items: [], nextCursor: null };
    where.clientId = { in: clientIds };
  }

  // La bandeja es operativa: primero lo asignado a quien inició sesión,
  // luego lo que ya está abierto y finalmente los mensajes por atender.
  // Prisma no puede ordenar por "asignado al usuario actual" sin SQL crudo,
  // así que recuperamos un conjunto acotado y aplicamos esa prioridad aquí.
  const rows = await prisma.whatsAppConversation.findMany({
    where,
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: query.cursor ? limit : 100,
    include: {
      client: {
        select: {
          id: true,
          recordNumber: true,
          fullName: true,
          whatsapp: true,
          email: true,
          active: true,
          createdAt: true,
        },
      },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });

  const [totalCount, pendingCount, resolvedCount] = await Promise.all([
    prisma.whatsAppConversation.count({ where: { ...baseWhere, status: { not: 'archived' } } }),
    prisma.whatsAppConversation.count({ where: { ...baseWhere, status: { in: ['open', 'pending'] } } }),
    prisma.whatsAppConversation.count({ where: { ...baseWhere, status: 'resolved' } }),
  ]);

  const priority = (conversation) => {
    if (conversation.assignedToUserId && conversation.assignedToUserId === actor.id) return 0;
    if (conversation.status === 'open') return 1;
    if (conversation.status === 'resolved' || conversation.status === 'archived') return 3;
    if (conversation.unreadCount > 0 || conversation.status === 'pending') return 2;
    return 3;
  };
  const orderedRows = [...rows].sort((a, b) => (
    priority(a) - priority(b)
    || new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    || String(b.id).localeCompare(String(a.id))
  ));
  const visibleRows = query.cursor ? orderedRows : orderedRows.slice(0, limit);
  const items = visibleRows.map(compactConversation);
  const last = visibleRows[visibleRows.length - 1];
  // La primera carga se prioriza en memoria; evitar un cursor cronológico
  // impide saltar conversaciones de alta prioridad en una segunda página.
  const nextCursor = query.cursor && visibleRows.length === limit && last
    ? `${last.lastMessageAt.toISOString()}|${last.id}`
    : null;
  return { items, nextCursor, counts: { all: totalCount, pending: pendingCount, resolved: resolvedCount } };
}

async function getConversation(actor, conversationId) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  return { ...conv, status: conversationStatusForList(conv), withinWindow: isWithinWindow(conv.lastInboundAt) };
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
    include: { sentBy: { select: { id: true, name: true } } },
  });
  return {
    items: rows.reverse(),
    nextCursor: rows.length === limit ? `${rows[0].createdAt.toISOString()}|${rows[0].id}` : null,
  };
}

async function getMessageMedia(actor, messageId) {
  const message = await prisma.whatsAppMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      tenantId: true,
      type: true,
      body: true,
      mediaId: true,
    },
  });
  if (!message) return null;
  assertTenantScope(actor, message.tenantId);
  if (!message.mediaId) throw new BadRequestError('Este mensaje no tiene archivo adjunto');

  const conn = await transport.loadActiveConnection(message.tenantId);
  if (!conn) throw new BadRequestError('WhatsApp no está conectado para este tenant');

  const info = await transport.getMediaInfo(conn, message.mediaId);
  if (!info.ok || !info.data?.url) {
    throw new BadRequestError(info.errorTitle || 'No se pudo obtener el archivo desde WhatsApp');
  }
  const downloaded = await transport.downloadMedia(conn, info.data.url);
  if (!downloaded.ok) {
    throw new BadRequestError(downloaded.errorTitle || 'No se pudo descargar el archivo desde WhatsApp');
  }
  return {
    buffer: downloaded.buffer,
    mimeType: info.data.mime_type || downloaded.mimeType || 'application/octet-stream',
    filename: sanitizeFilename(message.body || `whatsapp-${message.type || 'archivo'}`),
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
        senderType: 'agent',
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
    data: {
      lastOutboundAt: now,
      lastMessageAt: now,
      lastMessagePreview: previewOf(text),
      unreadCount: 0,
      unreadRestoreCount: 0,
      manuallyMarkedUnread: false,
      botActive: false,
      status: 'open',
      assignedToUserId: actor.id,
    },
  });
  publishConversationEvent(conv.tenantId, 'conversation.message.created', {
    conversationId: conv.id,
    messageId: updated.id,
    direction: 'outbound',
    senderType: 'agent',
  });
  return updated;
}

async function sendManualMedia(actor, conversationId, payload = {}) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  if (!isWithinWindow(conv.lastInboundAt)) {
    const err = new BadRequestError('WINDOW_CLOSED: pasaron más de 24h desde el último mensaje del cliente. Usá el recordatorio (plantilla).');
    err.status = 422;
    throw err;
  }

  const { buffer, mimeType } = decodeMediaDataUrl(payload.dataUrl);
  const filename = sanitizeFilename(payload.filename || 'archivo');
  const caption = String(payload.caption || '').trim().slice(0, 1024);
  const type = mediaTypeFromMime(mimeType);
  const supportsCaption = ['image', 'document', 'video'].includes(type);
  const displayBody = (supportsCaption ? caption : '') || filename || `[${type}]`;

  const conn = await transport.loadActiveConnection(conv.tenantId);
  if (!conn) throw new BadRequestError('WhatsApp no está conectado para este tenant');

  const message = await prisma.whatsAppMessage.create({
    data: {
      tenantId: conv.tenantId,
      conversationId: conv.id,
      direction: 'outbound',
      senderType: 'agent',
      type,
      status: 'queued',
      body: displayBody,
      sentByUserId: actor.id,
    },
  });

  const uploaded = await transport.uploadMedia(conn, buffer, mimeType, filename);
  if (!uploaded.ok) {
    const failed = await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        status: 'failed',
        errorCode: String(uploaded.status ?? ''),
        errorTitle: String(uploaded.errorTitle ?? '').slice(0, 250),
      },
    });
    return failed;
  }

  const send = await transport.sendMediaByMediaId(conn, conv.customerWaId, type, uploaded.mediaId, {
    caption: supportsCaption ? caption || undefined : undefined,
    filename: type === 'document' ? filename : undefined,
  });
  const finalState = send.ok
    ? { status: 'sent', waMessageId: send.data?.messages?.[0]?.id ?? null, mediaId: uploaded.mediaId }
    : { status: 'failed', mediaId: uploaded.mediaId, errorCode: String(send.errorCode ?? send.status ?? ''), errorTitle: String(send.errorTitle ?? '').slice(0, 250) };

  const updated = await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: finalState,
  });
  const now = new Date();
  await prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: {
      lastOutboundAt: now,
      lastMessageAt: now,
      lastMessagePreview: previewOf(displayBody),
      unreadCount: 0,
      unreadRestoreCount: 0,
      manuallyMarkedUnread: false,
      botActive: false,
      status: 'open',
      assignedToUserId: actor.id,
    },
  });
  publishConversationEvent(conv.tenantId, 'conversation.message.created', {
    conversationId: conv.id,
    messageId: updated.id,
    direction: 'outbound',
    senderType: 'agent',
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
      client: { is: { active: true } },
    },
    orderBy: { startsAt: 'asc' },
    include: { service: { select: { name: true } }, client: { select: { fullName: true, active: true } } },
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

  const client = nextPending.client;
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
      senderType: 'agent',
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
    data: { lastOutboundAt: now, lastMessageAt: now, lastMessagePreview: `[Recordatorio] ${nextPending.service.name}`, status: 'open', assignedToUserId: actor.id },
  });
  publishConversationEvent(conv.tenantId, 'conversation.message.created', {
    conversationId: conv.id,
    messageId: updated.id,
    direction: 'outbound',
    senderType: 'agent',
  });
  return updated;
}

async function markRead(actor, conversationId) {
  return setReadState(actor, conversationId, false);
}

async function setReadState(actor, conversationId, unread) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  const nextUnread = Boolean(unread);
  const nextCount = Math.max(Number(conv.unreadCount || 0), nextUnread ? 1 : 0);
  const data = nextUnread
    ? {
        unreadCount: nextCount,
        unreadRestoreCount: nextCount,
        manuallyMarkedUnread: true,
        status: 'pending',
      }
    : {
        unreadCount: 0,
        unreadRestoreCount: 0,
        manuallyMarkedUnread: false,
        lastReadAt: new Date(),
      };
  const updated = await prisma.whatsAppConversation.update({ where: { id: conv.id }, data });
  publishConversationEvent(conv.tenantId, nextUnread ? 'conversation.marked_unread' : 'conversation.marked_read', {
    conversationId: conv.id,
    unreadCount: updated.unreadCount,
    status: updated.status,
  });
  return updated;
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
  if (changes.botActive !== undefined) data.botActive = !!changes.botActive;
  if (changes.status !== undefined) {
    if (!['open', 'pending', 'resolved', 'archived'].includes(String(changes.status))) {
      throw new BadRequestError('status inválido');
    }
    data.status = String(changes.status);
    data.archived = String(changes.status) === 'archived';
  }
  if (changes.unreadCount !== undefined) {
    const unreadCount = Number(changes.unreadCount);
    if (!Number.isInteger(unreadCount) || unreadCount < 0 || unreadCount > 999) {
      throw new BadRequestError('unreadCount inválido');
    }
    data.unreadCount = unreadCount;
    if (unreadCount === 0) data.lastReadAt = new Date();
  }
  const updated = await prisma.whatsAppConversation.update({ where: { id: conv.id }, data });
  publishConversationEvent(conv.tenantId, 'conversation.updated', { conversationId: conv.id });
  return updated;
}

async function reactivateBot(actor, conversationId) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  botState.clearFlowState(conv.customerWaId);
  const updated = await prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: { botActive: true, botPausedUntil: null, botState: null },
  });
  publishConversationEvent(conv.tenantId, 'conversation.bot.updated', { conversationId: conv.id, botActive: true });
  return updated;
}

async function pauseBot(actor, conversationId) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  const updated = await prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: { botActive: false, botPausedUntil: null },
  });
  publishConversationEvent(conv.tenantId, 'conversation.bot.updated', { conversationId: conv.id, botActive: false });
  return updated;
}

async function setStatus(actor, conversationId, status) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  if (!['open', 'pending', 'resolved', 'archived'].includes(String(status))) {
    throw new BadRequestError('status inválido');
  }
  const data = {
    status: String(status),
    archived: String(status) === 'archived',
  };
  if (status === 'resolved') {
    data.unreadCount = 0;
    data.unreadRestoreCount = 0;
    data.manuallyMarkedUnread = false;
    data.botActive = true;
    data.botPausedUntil = null;
    data.botState = null;
    botState.clearFlowState(conv.customerWaId);
  }
  const updated = await prisma.whatsAppConversation.update({ where: { id: conv.id }, data });
  publishConversationEvent(conv.tenantId, 'conversation.status.updated', {
    conversationId: conv.id,
    status: updated.status,
  });
  return updated;
}

async function assignConversation(actor, conversationId, userId) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  let assignedToUserId = null;
  if (userId) {
    const user = await prisma.user.findFirst({
      where: { id: String(userId), tenantId: conv.tenantId, active: true },
      select: { id: true },
    });
    if (!user) throw new BadRequestError('Usuario inválido para asignar');
    assignedToUserId = user.id;
  }
  const updated = await prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: { assignedToUserId },
  });
  publishConversationEvent(conv.tenantId, 'conversation.assigned', {
    conversationId: conv.id,
    assignedToUserId,
  });
  return updated;
}

async function listAssignees(actor) {
  return prisma.user.findMany({
    where: {
      tenantId: actor.tenantId,
      active: true,
      role: { in: ['dueno', 'personal'] },
    },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
}

const VALID_LABELS = DEFAULT_LABELS.map((label) => label.key);

async function setLabels(actor, conversationId, labels) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  const labelDefinitions = await listLabelDefinitions(actor);
  const validLabels = new Set(labelDefinitions.map((label) => label.key));
  const filtered = [...new Set(labels.filter((l) => validLabels.has(l)))];
  const updated = await prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: { labels: filtered },
  });
  publishConversationEvent(conv.tenantId, 'conversation.tags.updated', {
    conversationId: conv.id,
    labels: filtered,
  });
  return updated;
}

async function listNotes(actor, conversationId) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  return prisma.whatsAppNote.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true, name: true } } },
  });
}

async function createNote(actor, conversationId, content) {
  const conv = await loadConversationForActor(actor, conversationId);
  if (!conv) return null;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new BadRequestError('El contenido de la nota es requerido');
  }
  const note = await prisma.whatsAppNote.create({
    data: {
      tenantId: conv.tenantId,
      conversationId: conv.id,
      content: content.trim().slice(0, 2000),
      authorId: actor.id,
    },
    include: { author: { select: { id: true, name: true } } },
  });
  publishConversationEvent(conv.tenantId, 'conversation.notes.updated', { conversationId: conv.id });
  return note;
}

async function deleteNote(actor, noteId) {
  const note = await prisma.whatsAppNote.findUnique({ where: { id: noteId } });
  if (!note) return null;
  assertTenantScope(actor, note.tenantId);
  await prisma.whatsAppNote.delete({ where: { id: noteId } });
  publishConversationEvent(note.tenantId, 'conversation.notes.updated', { conversationId: note.conversationId });
  return { deleted: true };
}

module.exports = {
  listConversations,
  getConversation,
  listMessages,
  getMessageMedia,
  sendManualText,
  sendManualMedia,
  sendReminder,
  markRead,
  setReadState,
  updateConversation,
  reactivateBot,
  pauseBot,
  setStatus,
  assignConversation,
  listAssignees,
  listLabelDefinitions,
  saveLabelDefinitions,
  listQuickReplies,
  saveQuickReplies,
  setLabels,
  listNotes,
  createNote,
  deleteNote,
  isWithinWindow,
  previewOf,
  todayRangeForTenant,
  VALID_LABELS,
  DEFAULT_LABELS,
  DEFAULT_QUICK_REPLIES,
};
