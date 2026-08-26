// Orquestador del bot de WhatsApp — Fase 2 (3-tier: botones → caché → IA).
//
// handleInboundMessage() se invoca desde webhooks/whatsapp.js DESPUÉS de que
// se insertó el WhatsAppMessage inbound.
//
// Resolución en 3 niveles:
//  Tier 1: botones interactivos → determinístico, sin costo.
//  Tier 2: caché de intenciones → texto normalizado → intent mapeado previamente.
//  Tier 3: Claude Haiku 4.5 → solo si no hay match de botón ni caché (~<20%).
//
// Si la IA no está disponible (sin ANTHROPIC_API_KEY), el bot funciona solo
// con botones — siempre muestra el menú principal ante texto libre.

const prisma = require('../../utils/prisma');
const transport = require('../whatsappTransport');
const serviceService = require('../serviceService');
const aiClient = require('../aiClient');
const state = require('./state');
const rateLimit = require('./rateLimit');
const menus = require('./menus');
const intentCache = require('./intentCache');
const { waIdToPhone } = require('../../utils/phone');

const RESERVAR_URL_BASE = process.env.PUBLIC_BASE_URL
  ? `${process.env.PUBLIC_BASE_URL}/reservar/`
  : 'https://tienes-que-configurar-PUBLIC_BASE_URL/reservar/';

const DAILY_COST_CAP_USD = 0.50;
const MAX_UNCLEAR_BEFORE_ESCALATE = 3;

function safeTail(value, size = 4) {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return str.length <= size ? str : str.slice(-size);
}

function logBot(level, event, data = {}) {
  console[level](`[BOT] ${event} ${JSON.stringify(data)}`);
}

async function humanAlreadyReplied(tenantId, conversationId) {
  const anyHuman = await prisma.whatsAppMessage.findFirst({
    where: { tenantId, conversationId, direction: 'outbound', sentByUserId: { not: null } },
    select: { id: true },
  });
  return !!anyHuman;
}

async function recordBotMessage(tenantId, conv, sendResult, { type = 'text', body = null }) {
  if (!sendResult?.ok) {
    logBot('warn', 'Meta rechazó respuesta', {
      conversationId: conv?.id ?? null,
      type,
      status: sendResult?.status ?? null,
      errorCode: sendResult?.errorCode ?? null,
      errorTitle: sendResult?.errorTitle
        ? String(sendResult.errorTitle).slice(0, 180)
        : null,
    });
    return;
  }
  const waMessageId = sendResult.data?.messages?.[0]?.id ?? null;
  try {
    await prisma.whatsAppMessage.create({
      data: {
        tenantId,
        conversationId: conv.id,
        direction: 'outbound',
        type,
        status: 'sent',
        waMessageId,
        body,
        sentByUserId: null,
      },
    });
    const now = new Date();
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: {
        lastOutboundAt: now,
        lastMessageAt: now,
        lastMessagePreview: body ? String(body).slice(0, 120) : `[${type}]`,
      },
    });
    logBot('info', 'respuesta registrada', {
      conversationId: conv.id,
      type,
      messageIdTail: safeTail(waMessageId, 8),
    });
  } catch (err) {
    logBot('warn', 'no se pudo registrar respuesta', {
      conversationId: conv?.id ?? null,
      error: transport.sanitizeError(err),
    });
  }
}

function detectTone(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  if (/\b(t[uú]|contigo|tuy[oa]|tienes|puedes|quer[eé]s|querías)\b/.test(t)) return 'tu';
  if (/\busted\b/.test(t)) return 'usted';
  return null;
}

async function getDailyCostForConversation(tenantId, conversationId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result = await prisma.botInteractionLog.aggregate({
    where: { tenantId, conversationId, createdAt: { gte: today } },
    _sum: { costUsd: true },
  });
  return Number(result._sum.costUsd || 0);
}

async function logBotInteraction(tenantId, conv, { userMessage, intent, reply, aiResult }) {
  try {
    await prisma.botInteractionLog.create({
      data: {
        tenantId,
        conversationId: conv.id,
        customerWaId: conv.customerWaId,
        userMessage: userMessage?.slice(0, 500) || null,
        detectedIntent: intent || null,
        botReplyText: reply?.slice(0, 500) || null,
        model: aiResult?.model || null,
        promptTokens: aiResult?.inputTokens || 0,
        completionTokens: aiResult?.outputTokens || 0,
        totalTokens: aiResult?.totalTokens || 0,
        costUsd: aiResult?.costUsd || 0,
        latencyMs: aiResult?.latencyMs || 0,
      },
    });
  } catch (err) {
    console.warn('[BOT] falla al registrar BotInteractionLog:', err.message);
  }
}

async function handleInboundMessage({ tenant, connection, conv, incoming }) {
  const waId = conv.customerWaId;

  if (await humanAlreadyReplied(tenant.id, conv.id)) {
    logBot('info', 'omitido: humano ya respondió', {
      tenant: tenant.slug,
      conversationId: conv.id,
      waIdTail: safeTail(waId),
    });
    return;
  }
  if (state.isEscalated(waId)) {
    logBot('info', 'omitido: conversación escalada', {
      tenant: tenant.slug,
      conversationId: conv.id,
      waIdTail: safeTail(waId),
    });
    return;
  }

  const gate = rateLimit.check(waId);
  if (!gate.allowed) {
    logBot('warn', 'rate limit aplicado', {
      tenant: tenant.slug,
      conversationId: conv.id,
      waIdTail: safeTail(waId),
      warn: Boolean(gate.warn),
    });
    if (gate.warn) {
      const warn = 'Recibí muchos mensajes seguidos 😅 Dame un momento y te respondo pronto 💛';
      const r = await transport.sendText(connection, waId, warn);
      await recordBotMessage(tenant.id, conv, r, { body: warn });
    }
    return;
  }

  const bodyText = incoming.type === 'text' ? incoming.text?.body ?? null : null;
  const priorState = state.getFlowState(waId) || {};
  const tone = detectTone(bodyText) || priorState.tone || 'usted';

  // Tier 1: interactive button/list reply → deterministic
  const interactive = incoming.interactive;
  const listId = interactive?.list_reply?.id;
  const buttonId = interactive?.button_reply?.id;
  const selectionId = listId || buttonId;

  if (selectionId) {
    logBot('info', 'selección recibida', {
      tenant: tenant.slug,
      conversationId: conv.id,
      selectionId,
    });
    return handleSelection({ tenant, connection, conv, waId, tone, selectionId });
  }

  // Text message → Tier 2 (cache) then Tier 3 (AI)
  if (bodyText) {
    logBot('info', 'texto recibido', {
      tenant: tenant.slug,
      conversationId: conv.id,
      aiDisponible: aiClient.isAvailable(),
    });
    return handleTextMessage({ tenant, connection, conv, waId, tone, bodyText });
  }

  // Non-text, non-interactive → main menu
  logBot('info', 'tipo no soportado; enviando menú base', {
    tenant: tenant.slug,
    conversationId: conv.id,
    type: incoming.type,
  });
  return sendMainMenu({ tenant, connection, conv, waId, tone });
}

async function handleTextMessage({ tenant, connection, conv, waId, tone, bodyText }) {
  // Tier 2: intent cache lookup
  const cached = intentCache.get(bodyText);
  if (cached) {
    logBot('info', 'intención resuelta por caché', {
      tenant: tenant.slug,
      conversationId: conv.id,
      intent: cached.intent,
    });
    await logBotInteraction(tenant.id, conv, {
      userMessage: bodyText, intent: cached.intent, reply: cached.reply,
    });
    return routeIntent({ tenant, connection, conv, waId, tone, intent: cached.intent, aiReply: cached.reply });
  }

  // Tier 3: AI classification (if available)
  if (!aiClient.isAvailable()) {
    logBot('info', 'IA no configurada; enviando menú base', {
      tenant: tenant.slug,
      conversationId: conv.id,
    });
    const flowState = state.getFlowState(waId);
    if (flowState?.flow) {
      const hint = tone === 'tu'
        ? 'No logré entender tu mensaje 🤔 Estas son las opciones:'
        : 'No logré entender su mensaje 🤔 Estas son las opciones:';
      const r = await transport.sendText(connection, waId, hint);
      await recordBotMessage(tenant.id, conv, r, { body: hint });
    }
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  // Cost cap check
  const dailyCost = await getDailyCostForConversation(tenant.id, conv.id);
  if (dailyCost >= DAILY_COST_CAP_USD) {
    logBot('warn', 'límite diario de IA alcanzado', {
      tenant: tenant.slug,
      conversationId: conv.id,
      dailyCost: Number(dailyCost.toFixed(4)),
    });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  const t0 = Date.now();
  const aiResult = await aiClient.classifyIntent(bodyText, { tone });
  const latencyMs = Date.now() - t0;

  if (!aiResult.ok) {
    logBot('warn', 'clasificación IA falló', {
      tenant: tenant.slug,
      conversationId: conv.id,
      error: aiResult.error,
    });
    await logBotInteraction(tenant.id, conv, {
      userMessage: bodyText, intent: null, reply: null,
      aiResult: { ...aiResult, latencyMs },
    });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  const enrichedAi = { ...aiResult, latencyMs };
  intentCache.set(bodyText, aiResult.intent, aiResult.reply);

  await logBotInteraction(tenant.id, conv, {
    userMessage: bodyText,
    intent: aiResult.intent,
    reply: aiResult.reply,
    aiResult: enrichedAi,
  });

  return routeIntent({
    tenant, connection, conv, waId, tone,
    intent: aiResult.intent,
    aiReply: aiResult.reply,
  });
}

async function routeIntent({ tenant, connection, conv, waId, tone, intent, aiReply }) {
  switch (intent) {
    case 'menu':
      return sendMainMenu({ tenant, connection, conv, waId, tone });
    case 'list_services':
      return handleListServices({ tenant, connection, conv, waId, tone });
    case 'book':
      return handleBook({ tenant, connection, conv, waId, tone });
    case 'my_appointment':
      return handleMyAppointment({ tenant, connection, conv, waId, tone });
    case 'cancel':
      return handleMyAppointment({ tenant, connection, conv, waId, tone });
    case 'escalate':
      return handleEscalate({ tenant, connection, conv, waId, tone });
    case 'service_info':
      if (aiReply) {
        const r = await transport.sendText(connection, waId, aiReply);
        await recordBotMessage(tenant.id, conv, r, { body: aiReply });
      }
      return handleListServices({ tenant, connection, conv, waId, tone });
    case 'unclear':
    default:
      return handleUnclear({ tenant, connection, conv, waId, tone, aiReply });
  }
}

async function handleUnclear({ tenant, connection, conv, waId, tone, aiReply }) {
  const flowState = state.getFlowState(waId) || {};
  const unclearCount = (flowState.unclearCount || 0) + 1;
  state.setFlowState(waId, { ...flowState, tone, unclearCount });

  if (unclearCount >= MAX_UNCLEAR_BEFORE_ESCALATE) {
    const msg = tone === 'tu'
      ? 'Parece que no logro entender 😅 Te paso con recepción para ayudarte mejor 💛'
      : 'Parece que no logro entender 😅 Le paso con recepción para ayudarle mejor 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return handleEscalate({ tenant, connection, conv, waId, tone });
  }

  if (aiReply) {
    const r = await transport.sendText(connection, waId, aiReply);
    await recordBotMessage(tenant.id, conv, r, { body: aiReply });
  }
  return sendMainMenu({ tenant, connection, conv, waId, tone });
}

async function sendMainMenu({ tenant, connection, conv, waId, tone }) {
  state.setFlowState(waId, { flow: 'menu', tone, unclearCount: 0 });
  const payload = menus.mainMenu({ tone });
  logBot('info', 'enviando menú principal', {
    tenant: tenant.slug,
    conversationId: conv.id,
    waIdTail: safeTail(waId),
  });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, {
    type: 'interactive',
    body: '[menú principal]',
  });
}

async function handleSelection({ tenant, connection, conv, waId, tone, selectionId }) {
  state.setFlowState(waId, { flow: 'selection', tone, unclearCount: 0 });

  if (selectionId === menus.NAV_BACK_MENU) {
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }
  if (selectionId === menus.MAIN_MENU_IDS.LIST_SERVICES) {
    return handleListServices({ tenant, connection, conv, waId, tone });
  }
  if (selectionId === menus.MAIN_MENU_IDS.BOOK) {
    return handleBook({ tenant, connection, conv, waId, tone });
  }
  if (selectionId === menus.MAIN_MENU_IDS.MY_APPOINTMENT) {
    return handleMyAppointment({ tenant, connection, conv, waId, tone });
  }
  if (selectionId === menus.MAIN_MENU_IDS.ESCALATE) {
    return handleEscalate({ tenant, connection, conv, waId, tone });
  }
  if (selectionId.startsWith(menus.CATEGORY_PREFIX)) {
    const categoryName = selectionId.slice(menus.CATEGORY_PREFIX.length);
    return handleCategoryServices({ tenant, connection, conv, waId, tone, categoryName });
  }
  if (selectionId.startsWith(menus.SERVICE_PREFIX)) {
    const serviceId = selectionId.slice(menus.SERVICE_PREFIX.length);
    return handleServiceDetail({ tenant, connection, conv, waId, tone, serviceId });
  }
  return sendMainMenu({ tenant, connection, conv, waId, tone });
}

async function handleListServices({ tenant, connection, conv, waId, tone }) {
  const svcs = await prisma.service.findMany({
    where: { tenantId: tenant.id, active: true },
    select: { id: true, name: true, category: true, priceUsd: true, durationMins: true, active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
  state.setFlowState(waId, { flow: 'listing_services', tone, unclearCount: 0 });

  if (svcs.length <= 10) {
    const payload = menus.servicesList(svcs, { tone });
    const r = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[lista de ${svcs.length} servicios]` });
    return;
  }

  const byCat = new Map();
  for (const s of svcs) {
    const cat = String(s.category || 'Otros');
    if (!byCat.has(cat)) byCat.set(cat, 0);
    byCat.set(cat, byCat.get(cat) + 1);
  }
  const categories = [...byCat.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, count }));
  const payload = menus.categoryList(categories, { tone });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[${categories.length} categorías]` });
}

async function handleCategoryServices({ tenant, connection, conv, waId, tone, categoryName }) {
  const svcs = await prisma.service.findMany({
    where: { tenantId: tenant.id, active: true, category: categoryName },
    select: { id: true, name: true, category: true, priceUsd: true, durationMins: true, active: true },
    orderBy: { name: 'asc' },
  });
  if (svcs.length === 0) {
    const msg = tone === 'tu'
      ? 'No encontré servicios en esa categoría 🤔 Te muestro el menú:'
      : 'No encontré servicios en esa categoría 🤔 Le muestro el menú:';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }
  state.setFlowState(waId, { flow: 'category_services', category: categoryName, tone, unclearCount: 0 });
  const payload = menus.servicesInCategory(svcs, categoryName, { tone });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[${svcs.length} servicios de ${categoryName}]` });
}

async function handleServiceDetail({ tenant, connection, conv, waId, tone, serviceId }) {
  const botActor = { id: 'bot', role: 'dueno', tenantId: tenant.id, email: 'bot@internal' };
  const svc = await serviceService.getService(botActor, serviceId);
  if (!svc || svc.active === false) {
    const msg = tone === 'tu'
      ? 'Ese servicio ya no está disponible 😅 Te muestro los actuales 🌿'
      : 'Ese servicio ya no está disponible 😅 Le muestro los actuales 🌿';
    const rr = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, rr, { body: msg });
    return handleListServices({ tenant, connection, conv, waId, tone });
  }

  const descLine = svc.description ? `\n\n${svc.description}` : '';
  const caption = `🌟 ${svc.name}\n$${Number(svc.priceUsd).toFixed(2)} · ${svc.durationMins || 60} min${descLine}`;

  const imgRes = await serviceService.getServiceImage(botActor, serviceId);
  const image = imgRes?.image;
  if (image?.data && image?.mimeType) {
    const uploaded = await transport.uploadMedia(connection, image.data, image.mimeType);
    if (uploaded.ok) {
      const sent = await transport.sendImageByMediaId(connection, waId, uploaded.mediaId, caption);
      await recordBotMessage(tenant.id, conv, sent, { type: 'image', body: `[foto] ${caption.slice(0, 100)}` });
    } else {
      console.warn('[BOT] uploadMedia falló, fallback a texto:', uploaded);
      const r = await transport.sendText(connection, waId, caption);
      await recordBotMessage(tenant.id, conv, r, { body: caption });
    }
  } else {
    const r = await transport.sendText(connection, waId, caption);
    await recordBotMessage(tenant.id, conv, r, { body: caption });
  }

  const backPayload = menus.backToMenuButton({ tone });
  const r2 = await transport.sendInteractive(connection, waId, backPayload);
  await recordBotMessage(tenant.id, conv, r2, { type: 'interactive', body: '[botón volver]' });
  state.setFlowState(waId, { flow: 'service_detail', lastServiceId: serviceId, tone, unclearCount: 0 });
}

async function handleBook({ tenant, connection, conv, waId, tone }) {
  const url = `${RESERVAR_URL_BASE}${tenant.slug}`;
  const msg = tone === 'tu'
    ? `📅 ¡Genial! Para reservar, entra aquí:\n${url}\n\nElige tu servicio, día y horario. Si necesitas ayuda, aquí estoy 💛`
    : `📅 ¡Genial! Para reservar, entre aquí:\n${url}\n\nElija su servicio, día y horario. Si necesita ayuda, aquí estoy 💛`;
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
  state.setFlowState(waId, { flow: 'menu', tone, unclearCount: 0 });
}

async function handleMyAppointment({ tenant, connection, conv, waId, tone }) {
  const phone = waIdToPhone(waId);
  const client = await prisma.client.findFirst({ where: { tenantId: tenant.id, whatsapp: phone } });
  if (!client) {
    const msg = tone === 'tu'
      ? 'No encontré citas a tu nombre 🤔 ¿Quieres reservar una? Te ayudo con gusto 💛'
      : 'No encontré citas a su nombre 🤔 ¿Desea reservar una? Le ayudo con gusto 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  const next = await prisma.appointment.findFirst({
    where: { tenantId: tenant.id, clientId: client.id, status: { in: ['pendiente', 'pendiente_bot', 'confirmado'] }, startsAt: { gte: new Date() } },
    orderBy: { startsAt: 'asc' },
    include: { service: true, room: true },
  });

  if (!next) {
    const msg = tone === 'tu'
      ? 'No tienes citas próximas 📋 ¿Quieres reservar una? Te ayudo con gusto 💛'
      : 'No tiene citas próximas 📋 ¿Desea reservar una? Le ayudo con gusto 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  const fecha = new Date(next.startsAt).toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil', weekday: 'long', day: '2-digit', month: 'long',
    hour: '2-digit', minute: '2-digit',
  });
  const estado = next.status === 'confirmado' ? 'confirmada' : 'pendiente de confirmar';
  const msg = tone === 'tu'
    ? `📋 Tu próxima cita:\n\n${next.service?.name}\n${fecha}\nCabina: ${next.room?.name || '—'}\nEstado: ${estado}\n\nSi necesitas cambiar algo, avísanos 💛`
    : `📋 Su próxima cita:\n\n${next.service?.name}\n${fecha}\nCabina: ${next.room?.name || '—'}\nEstado: ${estado}\n\nSi necesita cambiar algo, avísenos 💛`;
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
  state.setFlowState(waId, { flow: 'menu', tone, unclearCount: 0 });
}

async function handleEscalate({ tenant, connection, conv, waId, tone }) {
  state.markEscalated(waId);
  const msg = tone === 'tu'
    ? '👋 Te paso con recepción. Alguien te responderá pronto.\n¡Que tengas un lindo día! 🌿'
    : '👋 Le paso con recepción. Alguien le responderá pronto.\n¡Que tenga un lindo día! 🌿';
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
  state.clearFlowState(waId);
}

module.exports = {
  handleInboundMessage,
  _internals: {
    detectTone,
    humanAlreadyReplied,
    handleSelection,
    sendMainMenu,
    handleListServices,
    handleCategoryServices,
    handleServiceDetail,
    handleBook,
    handleMyAppointment,
    handleEscalate,
    handleTextMessage,
    handleUnclear,
    routeIntent,
    getDailyCostForConversation,
    logBotInteraction,
  },
};
