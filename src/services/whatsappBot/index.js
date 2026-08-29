// Orquestador del bot de WhatsApp — Fase 3 (conversacional + reserva in-app).
//
// handleInboundMessage() se invoca desde webhooks/whatsapp.js DESPUÉS de que
// se insertó el WhatsAppMessage inbound.
//
// Resolución en 3 niveles:
//  Tier 1: botones interactivos → determinístico, sin costo.
//  Tier 2: caché de intenciones → texto normalizado → intent mapeado previamente.
//  Tier 3: Claude Haiku 4.5 conversacional → contexto + historial → JSON estructurado.
//
// Si la IA no está disponible (sin ANTHROPIC_API_KEY), el bot funciona solo
// con botones — siempre muestra el menú principal ante texto libre.
//
// Reservas se cierran 100% dentro de WhatsApp (NUNCA links externos).

const prisma = require('../../utils/prisma');
const transport = require('../whatsappTransport');
const serviceService = require('../serviceService');
const appointmentService = require('../appointmentService');
const clientService = require('../clientService');
const aiClient = require('../aiClient');
const state = require('./state');
const rateLimit = require('./rateLimit');
const menus = require('./menus');
const intentCache = require('./intentCache');
const crmEvents = require('../crmEventBus');
const { waIdToPhone } = require('../../utils/phone');
const { SlotUnavailableError } = require('../../utils/errors');

const DAILY_COST_CAP_USD = 0.50;
const MAX_UNCLEAR_BEFORE_ESCALATE = 3;
const DIAG_WAID = '593993629256'; // TEMPORAL — quitar tras resolver P1

function safeTail(value, size = 4) {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return str.length <= size ? str : str.slice(-size);
}

function logBot(level, event, data = {}) {
  console[level](`[BOT] ${event} ${JSON.stringify(data)}`);
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
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
        senderType: 'bot',
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
    crmEvents.publish(tenantId, 'conversation.message.created', {
      tenantId,
      conversationId: conv.id,
      messageId: waMessageId,
      direction: 'outbound',
      senderType: 'bot',
      at: new Date().toISOString(),
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

function detectDeterministicIntent(text) {
  if (!text) return null;
  const t = String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|menu|menú|inicio)$/.test(t)) return 'greeting';
  if (/^(1|servicio|servicios|catalogo|catalogo de servicios|precios|precio)$/.test(t)) return 'list_services';
  if (/^(2|reservar|reserva|agendar|agenda|cita|quiero reservar|quiero agendar)$/.test(t)) return 'book_start';
  if (/^(3|mi cita|mis citas|consultar cita|ver cita)$/.test(t)) return 'my_appointment';
  if (/^(4|humano|asesor|asesora|recepcion|recepción|persona|hablar con recepcion|hablar con recepción)$/.test(t)) return 'escalate';
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

async function lookupClientByWaId(tenantId, waId) {
  const phone = waIdToPhone(waId);
  return prisma.client.findFirst({ where: { tenantId, whatsapp: phone } });
}

async function loadServicesForAI(tenantId) {
  return prisma.service.findMany({
    where: { tenantId, active: true },
    select: { id: true, name: true, category: true, priceUsd: true, durationMins: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
}

async function matchServiceByQuery(tenantId, query) {
  if (!query) return null;
  const q = String(query).toLowerCase().trim();
  const services = await prisma.service.findMany({
    where: { tenantId, active: true },
    select: { id: true, name: true, category: true, priceUsd: true, durationMins: true },
  });
  return services.find(s => String(s.name).toLowerCase().includes(q))
    || services.find(s => q.includes(String(s.name).toLowerCase().slice(0, 6)))
    || null;
}

// ─── Entry point ───────────────────────────────────────────────

async function handleInboundMessage({ tenant, connection, conv, incoming }) {
  const waId = conv.customerWaId;

  if (conv.botActive === false) {
    logBot('info', 'omitido: bot desactivado para esta conversación', {
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
    state.pushHistory(waId, 'user', bodyText);
    logBot('info', 'texto recibido', {
      tenant: tenant.slug,
      conversationId: conv.id,
      aiDisponible: aiClient.isAvailable(),
    });

    // Explicit menu keyword → show menu immediately (no AI call)
    if (/^(men[uú]|opciones|inicio|volver)$/i.test(bodyText.trim())) {
      return sendMainMenu({ tenant, connection, conv, waId, tone });
    }

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

// ─── Text message handler ──────────────────────────────────────

async function handleTextMessage({ tenant, connection, conv, waId, tone, bodyText }) {
  const flowState = state.getFlowState(waId) || {};

  // If we're in a booking flow and user sends text, handle contextually
  if (flowState.booking?.step === 'ask_name') {
    return handleNameCapture({ tenant, connection, conv, waId, tone, name: bodyText });
  }

  const deterministicIntent = detectDeterministicIntent(bodyText);
  if (deterministicIntent) {
    logBot('info', 'intención determinística resuelta', {
      tenant: tenant.slug,
      conversationId: conv.id,
      intent: deterministicIntent,
    });
    await logBotInteraction(tenant.id, conv, {
      userMessage: bodyText,
      intent: deterministicIntent,
      reply: null,
    });
    return routeIntent({ tenant, connection, conv, waId, tone, intent: deterministicIntent });
  }

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

  // Tier 3: AI (if available)
  if (!aiClient.isAvailable()) {
    logBot('info', 'IA no configurada; enviando menú base', {
      tenant: tenant.slug,
      conversationId: conv.id,
    });
    if (flowState.flow) {
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

  // Build AI context
  const client = await lookupClientByWaId(tenant.id, waId);
  const clientName = client?.fullName || flowState.clientName || null;
  const services = await loadServicesForAI(tenant.id);
  const history = state.getHistory(waId);

  const t0 = Date.now();
  const aiResult = await aiClient.chat(bodyText, {
    tone,
    clientName,
    services,
    history,
    bookingState: flowState.booking || null,
  });
  const latencyMs = Date.now() - t0;

  if (!aiResult.ok) {
    logBot('warn', 'chat IA falló', {
      tenant: tenant.slug,
      conversationId: conv.id,
      error: aiResult.error,
    });
    await logBotInteraction(tenant.id, conv, {
      userMessage: bodyText, intent: null, reply: null,
      aiResult: { ...aiResult, latencyMs },
    });
    logBot('info', 'cayó a menú', { intent: null, hasReply: false, desdeHandler: 'handleTextMessage:aiFailed' });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  const enrichedAi = { ...aiResult, latencyMs };

  logBot('info', 'IA respondió', {
    tenant: tenant.slug,
    conversationId: conv.id,
    intent: aiResult.intent,
    hasReply: Boolean(aiResult.replyText),
    params: Object.keys(aiResult.params || {}),
    rawAiText: String(aiResult.rawText || '').slice(0, 400),
    parseOk: Boolean(aiResult.parseOk),
    latencyMs,
    costUsd: Number((aiResult.costUsd || 0).toFixed(4)),
  });

  intentCache.set(bodyText, aiResult.intent, aiResult.replyText);

  await logBotInteraction(tenant.id, conv, {
    userMessage: bodyText,
    intent: aiResult.intent,
    reply: aiResult.replyText,
    aiResult: enrichedAi,
  });

  if (aiResult.replyText) {
    state.pushHistory(waId, 'assistant', aiResult.replyText);
  }

  if (clientName) {
    state.setFlowState(waId, { clientName });
  }

  return routeIntent({
    tenant, connection, conv, waId, tone,
    intent: aiResult.intent,
    aiReply: aiResult.replyText,
    params: aiResult.params,
  });
}

// ─── Intent router ─────────────────────────────────────────────

async function routeIntent({ tenant, connection, conv, waId, tone, intent, aiReply, params }) {
  switch (intent) {
    case 'menu':
      logBot('info', 'cayó a menú', { intent, hasReply: Boolean(aiReply), desdeHandler: 'routeIntent:menu' });
      return sendMainMenu({ tenant, connection, conv, waId, tone });

    case 'greeting': {
      // First interaction (history only has current message) → show greeting menu
      const history = state.getHistory(waId);
      if (history.length <= 1 && !aiReply) {
        logBot('info', 'cayó a menú', { intent, hasReply: false, desdeHandler: 'routeIntent:greeting:first' });
        return sendMainMenu({ tenant, connection, conv, waId, tone });
      }
      // Subsequent greetings → AI reply only (no menu)
      if (aiReply) {
        const r = await transport.sendText(connection, waId, aiReply);
        await recordBotMessage(tenant.id, conv, r, { body: aiReply });
        return;
      }
      logBot('info', 'cayó a menú', { intent, hasReply: false, desdeHandler: 'routeIntent:greeting:noReply' });
      return sendMainMenu({ tenant, connection, conv, waId, tone });
    }

    case 'list_services':
      return handleListServices({ tenant, connection, conv, waId, tone });

    case 'book':
    case 'book_start':
      return handleBook({ tenant, connection, conv, waId, tone, aiReply });

    case 'book_service': {
      if (params?.service_query) {
        const svc = await matchServiceByQuery(tenant.id, params.service_query);
        if (svc) {
          if (params.date) {
            return handleSmartBooking({ tenant, connection, conv, waId, tone, service: svc, date: params.date, time: params.time || null, aiReply });
          }
          return handleBookingServiceSelected({ tenant, connection, conv, waId, tone, serviceId: svc.id });
        }
      }
      return handleBook({ tenant, connection, conv, waId, tone, aiReply });
    }

    case 'my_appointment':
    case 'cancel':
      return handleMyAppointment({ tenant, connection, conv, waId, tone });

    case 'escalate':
      return handleEscalate({ tenant, connection, conv, waId, tone });

    case 'service_info':
    case 'suggest_service': {
      if (aiReply) {
        const r = await transport.sendText(connection, waId, aiReply);
        await recordBotMessage(tenant.id, conv, r, { body: aiReply });
        return;
      }
      if (params?.service_query) {
        const svc = await matchServiceByQuery(tenant.id, params.service_query);
        if (svc) {
          return handleServiceDetail({ tenant, connection, conv, waId, tone, serviceId: svc.id });
        }
      }
      return handleListServices({ tenant, connection, conv, waId, tone });
    }

    case 'chitchat':
      if (aiReply) {
        const r = await transport.sendText(connection, waId, aiReply);
        await recordBotMessage(tenant.id, conv, r, { body: aiReply });
      }
      return;

    case 'unclear':
    default:
      return handleUnclear({ tenant, connection, conv, waId, tone, aiReply });
  }
}

// ─── Core handlers ─────────────────────────────────────────────

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

  // ONE response: AI reply if available, menu as fallback
  if (aiReply) {
    const r = await transport.sendText(connection, waId, aiReply);
    await recordBotMessage(tenant.id, conv, r, { body: aiReply });
    return;
  }
  logBot('info', 'cayó a menú', { intent: 'unclear', hasReply: false, desdeHandler: 'handleUnclear:noReply' });
  return sendMainMenu({ tenant, connection, conv, waId, tone });
}

async function sendMainMenu({ tenant, connection, conv, waId, tone }) {
  const prev = state.getFlowState(waId) || {};
  state.setFlowState(waId, { flow: 'menu', tone, unclearCount: 0, clientName: prev.clientName || null });
  const payload = menus.mainMenu({ tone });
  logBot('info', 'enviando menú principal', {
    tenant: tenant.slug,
    conversationId: conv.id,
    waIdTail: safeTail(waId),
  });
  const r = await transport.sendInteractive(connection, waId, payload);
  if (r.ok) {
    await recordBotMessage(tenant.id, conv, r, {
      type: 'interactive',
      body: '[menú principal]',
    });
    return;
  }

  const fallback = menus.mainMenuText({ tone });
  logBot('warn', 'menú interactivo rechazado; enviando menú de texto', {
    tenant: tenant.slug,
    conversationId: conv.id,
    status: r.status ?? null,
    errorCode: r.errorCode ?? null,
  });
  const textResult = await transport.sendText(connection, waId, fallback);
  await recordBotMessage(tenant.id, conv, textResult, { body: fallback });
}

async function handleSelection({ tenant, connection, conv, waId, tone, selectionId }) {
  // Booking flow selections — do NOT reset state (booking data must survive)
  if (selectionId.startsWith(menus.BOOK_DATE_PREFIX)) {
    const date = selectionId.slice(menus.BOOK_DATE_PREFIX.length);
    return handleBookingDateSelected({ tenant, connection, conv, waId, tone, date });
  }
  if (selectionId.startsWith(menus.BOOK_TIME_PREFIX)) {
    const idx = parseInt(selectionId.slice(menus.BOOK_TIME_PREFIX.length), 10);
    return handleBookingTimeSelected({ tenant, connection, conv, waId, tone, slotIndex: idx });
  }
  if (selectionId === menus.BOOK_CONFIRM_YES) {
    return handleBookingConfirm({ tenant, connection, conv, waId, tone });
  }
  if (selectionId === menus.BOOK_CONFIRM_NO) {
    const prev = state.getFlowState(waId) || {};
    state.setFlowState(waId, { flow: 'menu', booking: null, clientName: prev.clientName, tone, unclearCount: 0 });
    const msg = tone === 'tu'
      ? 'Sin problema, cancelé la reserva 🌿 ¿Te ayudo con algo más?'
      : 'Sin problema, cancelé la reserva 🌿 ¿Le ayudo con algo más?';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  // Service selection — check if we're in booking mode before resetting state
  if (selectionId.startsWith(menus.SERVICE_PREFIX)) {
    const serviceId = selectionId.slice(menus.SERVICE_PREFIX.length);
    const fs = state.getFlowState(waId);
    if (fs?.booking?.step === 'select_service') {
      return handleBookingServiceSelected({ tenant, connection, conv, waId, tone, serviceId });
    }
    state.setFlowState(waId, { flow: 'selection', tone, unclearCount: 0 });
    return handleServiceDetail({ tenant, connection, conv, waId, tone, serviceId });
  }

  // Non-booking selections — safe to reset state
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

  return sendMainMenu({ tenant, connection, conv, waId, tone });
}

async function handleListServices({ tenant, connection, conv, waId, tone }) {
  const svcs = await prisma.service.findMany({
    where: { tenantId: tenant.id, active: true },
    select: { id: true, name: true, category: true, priceUsd: true, durationMins: true, active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
  state.setFlowState(waId, { flow: 'listing_services', tone, unclearCount: 0 });

  const visible = svcs.filter((s) => !menus.HIDDEN_CATEGORIES.has(String(s.category || '').toLowerCase().trim()));
  if (visible.length <= 10) {
    const payload = menus.servicesList(visible, { tone });
    const r = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[lista de ${visible.length} servicios]` });
    return;
  }

  const categories = buildVisibleCategories(visible);
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

// ─── Helpers ──────────────────────────────────────────────────

function buildVisibleCategories(services) {
  const byCat = new Map();
  for (const s of services) {
    const cat = String(s.category || 'Otros');
    if (menus.HIDDEN_CATEGORIES.has(cat.toLowerCase().trim())) continue;
    if (!byCat.has(cat)) byCat.set(cat, 0);
    byCat.set(cat, byCat.get(cat) + 1);
  }
  return [...byCat.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, count }));
}

// ─── Booking flow ──────────────────────────────────────────────

async function handleBook({ tenant, connection, conv, waId, tone, aiReply }) {
  const svcs = await prisma.service.findMany({
    where: { tenantId: tenant.id, active: true },
    select: { id: true, name: true, category: true, priceUsd: true, durationMins: true, active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  const visible = svcs.filter((s) => !menus.HIDDEN_CATEGORIES.has(String(s.category || '').toLowerCase().trim()));
  if (visible.length === 0) {
    const msg = tone === 'tu'
      ? 'Aún no tenemos servicios cargados 😅 Comunícate con recepción 💛'
      : 'Aún no tenemos servicios cargados 😅 Comuníquese con recepción 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  const prev = state.getFlowState(waId) || {};
  state.setFlowState(waId, { flow: 'booking', booking: { step: 'select_service' }, clientName: prev.clientName, tone, unclearCount: 0 });

  const intro = aiReply || (tone === 'tu'
    ? '✨ ¡Qué bueno que quieres reservar! Elige el servicio:'
    : '✨ ¡Qué bueno que desea reservar! Elija el servicio:');

  if (visible.length <= 10) {
    const payload = menus.servicesList(visible, { tone, body: intro });
    const r = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: '[selección de servicio para reserva]' });
  } else {
    const categories = buildVisibleCategories(visible);
    const payload = menus.categoryList(categories, { tone, body: intro });
    const r = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[${categories.length} categorías para reserva]` });
  }
}

async function handleSmartBooking({ tenant, connection, conv, waId, tone, service, date, time, aiReply }) {
  const tenantData = await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { config: true } });
  let slots;
  try {
    slots = await appointmentService.getAvailability({
      tenantId: tenant.id,
      tenantConfig: tenantData?.config,
      serviceId: service.id,
      date,
      modality: 'spa',
    });
  } catch (err) {
    logBot('warn', 'smart booking: error de disponibilidad', { error: err.message, date });
    return handleBookingServiceSelected({ tenant, connection, conv, waId, tone, serviceId: service.id });
  }

  const prev = state.getFlowState(waId) || {};

  if (slots.length === 0) {
    state.setFlowState(waId, {
      flow: 'booking',
      booking: { step: 'select_date', serviceId: service.id, serviceName: service.name },
      clientName: prev.clientName,
      tone,
      unclearCount: 0,
    });
    const body = tone === 'tu'
      ? `😔 No hay horarios ese día para ${service.name}. ¿Probamos otro?`
      : `😔 No hay horarios ese día para ${service.name}. ¿Probamos otro?`;
    const payload = menus.datePicker({ tone, body });
    const r = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: '[sin horarios, elegir otro día]' });
    return;
  }

  state.setFlowState(waId, {
    flow: 'booking',
    booking: { step: 'select_time', serviceId: service.id, serviceName: service.name, date, availableSlots: slots },
    clientName: prev.clientName,
    tone,
    unclearCount: 0,
  });

  if (time) {
    const matchedIdx = slots.findIndex((isoStr) => {
      const d = new Date(isoStr);
      const slotTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: menus.SPA_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d);
      return slotTime === time;
    });

    if (matchedIdx >= 0) {
      return handleBookingTimeSelected({ tenant, connection, conv, waId, tone, slotIndex: matchedIdx });
    }

    const body = tone === 'tu'
      ? `😅 No hay horario a las ${time} para ${service.name}, pero tengo estos:`
      : `😅 No hay horario a las ${time} para ${service.name}, pero tengo estos:`;
    const payload = slots.length <= 3
      ? menus.timeSlotButtons(slots, service.name, { tone })
      : menus.timeSlotList(slots, service.name, { tone, body });
    if (slots.length <= 3) payload.body = { text: body };
    const r = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: '[horarios alternativos]' });
    return;
  }

  const payload = slots.length <= 3
    ? menus.timeSlotButtons(slots, service.name, { tone })
    : menus.timeSlotList(slots, service.name, { tone });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[${slots.length} horarios para ${date}]` });
}

async function handleBookingServiceSelected({ tenant, connection, conv, waId, tone, serviceId }) {
  const botActor = { id: 'bot', role: 'dueno', tenantId: tenant.id, email: 'bot@internal' };
  const svc = await serviceService.getService(botActor, serviceId);
  if (!svc || !svc.active) {
    const msg = tone === 'tu'
      ? 'Ese servicio ya no está disponible 😅 Elige otro:'
      : 'Ese servicio ya no está disponible 😅 Elija otro:';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return handleBook({ tenant, connection, conv, waId, tone });
  }

  const prev = state.getFlowState(waId) || {};
  state.setFlowState(waId, {
    flow: 'booking',
    booking: { step: 'select_date', serviceId: svc.id, serviceName: svc.name },
    clientName: prev.clientName,
    tone,
    unclearCount: 0,
  });

  const body = tone === 'tu'
    ? `🌟 ${svc.name} — ¡excelente elección! ¿Qué día te queda bien?`
    : `🌟 ${svc.name} — ¡excelente elección! ¿Qué día le queda bien?`;
  const payload = menus.datePicker({ tone, body });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[fecha para ${svc.name}]` });
}

async function handleBookingDateSelected({ tenant, connection, conv, waId, tone, date }) {
  const fs = state.getFlowState(waId);
  if (!fs?.booking?.serviceId) {
    return handleBook({ tenant, connection, conv, waId, tone });
  }

  const tenantData = await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { config: true } });

  let slots;
  try {
    slots = await appointmentService.getAvailability({
      tenantId: tenant.id,
      tenantConfig: tenantData?.config,
      serviceId: fs.booking.serviceId,
      date,
      modality: 'spa',
    });
  } catch (err) {
    logBot('warn', 'error al buscar disponibilidad', { error: err.message });
    const msg = tone === 'tu'
      ? 'Hubo un problema al buscar horarios 😅 Probemos de nuevo:'
      : 'Hubo un problema al buscar horarios 😅 Probemos de nuevo:';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    const dp = menus.datePicker({ tone });
    const r2 = await transport.sendInteractive(connection, waId, dp);
    await recordBotMessage(tenant.id, conv, r2, { type: 'interactive', body: '[selección de fecha]' });
    return;
  }

  if (slots.length === 0) {
    const msg = tone === 'tu'
      ? '😔 No hay horarios disponibles ese día. ¿Probamos otro?'
      : '😔 No hay horarios disponibles ese día. ¿Probamos otro?';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    const dp = menus.datePicker({ tone });
    const r2 = await transport.sendInteractive(connection, waId, dp);
    await recordBotMessage(tenant.id, conv, r2, { type: 'interactive', body: '[selección de fecha]' });
    return;
  }

  state.setFlowState(waId, {
    flow: 'booking',
    booking: { ...fs.booking, step: 'select_time', date, availableSlots: slots },
    clientName: fs.clientName,
    tone,
    unclearCount: 0,
  });

  const payload = slots.length <= 3
    ? menus.timeSlotButtons(slots, fs.booking.serviceName, { tone })
    : menus.timeSlotList(slots, fs.booking.serviceName, { tone });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[${slots.length} horarios para ${date}]` });
}

async function handleBookingTimeSelected({ tenant, connection, conv, waId, tone, slotIndex }) {
  const fs = state.getFlowState(waId);
  if (!fs?.booking?.availableSlots || !fs.booking.serviceId) {
    return handleBook({ tenant, connection, conv, waId, tone });
  }

  const slot = fs.booking.availableSlots[slotIndex];
  if (!slot) {
    const msg = tone === 'tu'
      ? 'Ese horario ya no está disponible 😅 Elige otro:'
      : 'Ese horario ya no está disponible 😅 Elija otro:';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    const payload = menus.timeSlotList(fs.booking.availableSlots, fs.booking.serviceName, { tone });
    const r2 = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r2, { type: 'interactive', body: '[horarios]' });
    return;
  }

  const client = await lookupClientByWaId(tenant.id, waId);
  const clientName = client?.fullName || fs.clientName;

  state.setFlowState(waId, {
    flow: 'booking',
    booking: { ...fs.booking, step: clientName ? 'confirm' : 'ask_name', timeSlot: slot },
    tone,
    unclearCount: 0,
  });

  if (!clientName) {
    const msg = menus.askNameText({ tone });
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return;
  }

  return showBookingConfirmation({ tenant, connection, conv, waId, tone, clientName });
}

async function handleNameCapture({ tenant, connection, conv, waId, tone, name }) {
  const trimmed = String(name).trim();
  if (trimmed.length < 2 || trimmed.length > 100) {
    const msg = tone === 'tu'
      ? 'Escribe tu nombre completo, por favor 💛'
      : 'Escriba su nombre completo, por favor 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return;
  }

  state.setFlowState(waId, { clientName: trimmed });
  return showBookingConfirmation({ tenant, connection, conv, waId, tone, clientName: trimmed });
}

async function showBookingConfirmation({ tenant, connection, conv, waId, tone, clientName }) {
  const fs = state.getFlowState(waId);
  const booking = fs?.booking;
  if (!booking?.serviceId || !booking?.timeSlot) {
    return handleBook({ tenant, connection, conv, waId, tone });
  }

  const slotDate = new Date(booking.timeSlot);
  const TZ = menus.SPA_TZ;
  const fechaStr = new Intl.DateTimeFormat('es-EC', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
  }).format(slotDate);
  const horaStr = new Intl.DateTimeFormat('es-EC', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(slotDate);

  const summary = `🌟 ${booking.serviceName}\n📅 ${capitalize(fechaStr)}\n🕐 ${horaStr}\n👤 ${clientName}`;

  state.setFlowState(waId, {
    flow: 'booking',
    booking: { ...booking, step: 'confirm', clientName },
    clientName,
    tone,
    unclearCount: 0,
  });

  const payload = menus.bookingConfirmation(summary, { tone });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[confirmación: ${booking.serviceName}]` });
}

async function handleBookingConfirm({ tenant, connection, conv, waId, tone }) {
  const fs = state.getFlowState(waId);
  const booking = fs?.booking;
  if (!booking?.serviceId || !booking?.timeSlot || !booking?.clientName) {
    return handleBook({ tenant, connection, conv, waId, tone });
  }

  const phone = waIdToPhone(waId);

  try {
    await prisma.$transaction(async (tx) => {
      const client = await clientService.upsertClient(tx, tenant.id, {
        fullName: booking.clientName,
        whatsapp: phone,
      });

      const tenantData = await tx.tenant.findUnique({ where: { id: tenant.id }, select: { config: true } });

      await appointmentService.resolveAndCreateAppointment(tx, {
        tenantId: tenant.id,
        tenantConfig: tenantData?.config,
        clientId: client.id,
        serviceId: booking.serviceId,
        startsAt: new Date(booking.timeSlot),
        modality: 'spa',
        status: 'pendiente_bot',
      });
    });

    const slotDate = new Date(booking.timeSlot);
    const TZ = menus.SPA_TZ;
    const fechaStr = new Intl.DateTimeFormat('es-EC', {
      timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
    }).format(slotDate);
    const horaStr = new Intl.DateTimeFormat('es-EC', {
      timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(slotDate);

    const msg = tone === 'tu'
      ? `✅ ¡Listo, ${booking.clientName}! Tu cita está reservada 🌿\n\n🌟 ${booking.serviceName}\n📅 ${capitalize(fechaStr)}\n🕐 ${horaStr}\n\nTe esperamos con mucho cariño 💛`
      : `✅ ¡Listo, ${booking.clientName}! Su cita está reservada 🌿\n\n🌟 ${booking.serviceName}\n📅 ${capitalize(fechaStr)}\n🕐 ${horaStr}\n\nLe esperamos con mucho cariño 💛`;
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });

    state.setFlowState(waId, { flow: 'menu', booking: null, clientName: booking.clientName, tone, unclearCount: 0 });

  } catch (err) {
    logBot('warn', 'error al crear reserva', { error: err.message, serviceId: booking.serviceId });

    if (err instanceof SlotUnavailableError) {
      const msg = tone === 'tu'
        ? '😔 Ese horario se acaba de ocupar. ¿Probamos otra hora?'
        : '😔 Ese horario se acaba de ocupar. ¿Probamos otra hora?';
      const r = await transport.sendText(connection, waId, msg);
      await recordBotMessage(tenant.id, conv, r, { body: msg });
      state.setFlowState(waId, {
        flow: 'booking',
        booking: { step: 'select_date', serviceId: booking.serviceId, serviceName: booking.serviceName },
        clientName: booking.clientName,
        tone,
        unclearCount: 0,
      });
      const dp = menus.datePicker({ tone });
      const r2 = await transport.sendInteractive(connection, waId, dp);
      await recordBotMessage(tenant.id, conv, r2, { type: 'interactive', body: '[selección de fecha]' });
    } else {
      const msg = tone === 'tu'
        ? 'Hubo un problema al crear tu reserva 😅 Te paso con recepción 💛'
        : 'Hubo un problema al crear su reserva 😅 Le paso con recepción 💛';
      const r = await transport.sendText(connection, waId, msg);
      await recordBotMessage(tenant.id, conv, r, { body: msg });

      // TEMPORAL — eco de error solo para el número de diagnóstico
      if (waId === DIAG_WAID) {
        const stackLines = err?.stack ? String(err.stack).split('\n').slice(0, 4).join('\n') : '';
        const raw = `[DIAG] ${err?.message || 'sin mensaje'}\n${stackLines}`;
        const safe = raw.replace(/(?:ANTHROPIC_API_KEY|DATABASE_URL|WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET)=[^\s]*/gi, '[REDACTED]');
        const diagMsg = safe.slice(0, 900);
        try {
          await transport.sendText(connection, waId, diagMsg);
        } catch (_) { /* no bloquear si falla el eco */ }
      }

      return handleEscalate({ tenant, connection, conv, waId, tone });
    }
  }
}

// ─── Other handlers ────────────────────────────────────────────

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

  state.setFlowState(waId, { clientName: client.fullName });

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
  state.setFlowState(waId, { flow: 'menu', clientName: client.fullName, tone, unclearCount: 0 });
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
    capitalize,
    humanAlreadyReplied,
    handleSelection,
    sendMainMenu,
    handleListServices,
    handleCategoryServices,
    handleServiceDetail,
    handleBook,
    handleSmartBooking,
    handleBookingServiceSelected,
    handleBookingDateSelected,
    handleBookingTimeSelected,
    handleBookingConfirm,
    handleNameCapture,
    showBookingConfirmation,
    handleMyAppointment,
    handleEscalate,
    handleTextMessage,
    handleUnclear,
    routeIntent,
    getDailyCostForConversation,
    logBotInteraction,
    lookupClientByWaId,
    matchServiceByQuery,
    buildVisibleCategories,
    handleSmartBooking,
  },
};
