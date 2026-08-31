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
const HIDDEN_SERVICE_NAMES = new Set(['cumpleanos', 'cumpleaños', 'valoracion', 'valoración']);
const WEEKDAY_INDEX = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};
const MONTH_INDEX = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};
const SERVICE_INTENT_WORDS = ['servicio', 'servicios', 'servcios', 'servcio', 'serbicio', 'catalogo', 'catalogos', 'tratamiento', 'tratamientos', 'precio', 'precios'];
const QUESTION_INTENT_WORDS = ['que', 'q', 'k', 'cuales', 'cual', 'cuantos', 'tienen', 'tiene', 'ofrecen', 'ofrece', 'nomas', 'son', 'hay'];
const BOOK_INTENT_WORDS = ['reservar', 'reserva', 'reservacion', 'reseva', 'reserba', 'agendar', 'ajendar', 'agenda', 'cita', 'sita'];
const EXPLAIN_INTENT_WORDS = ['explica', 'explicame', 'cuentame', 'trata', 'incluye', 'sirve', 'hace'];
const CURRENT_SERVICE_WORDS = ['eso', 'este', 'esta', 'servicio', 'tratamiento', 'masaje', 'terapia'];
const APPOINTMENT_QUERY_WORDS = ['consultar', 'consulta', 'ver', 'saber', 'revisar', 'proxima', 'prox'];
const RESCHEDULE_WORDS = ['reagendar', 'reagendo', 'reagendamiento', 'reprogramar', 'reprogramo', 'reprogramacion', 'cambiar', 'mover', 'cambio'];
const BUSINESS_HOURS_WORDS = ['horario', 'horarios', 'atienden', 'atiende', 'abren', 'abre', 'cierran', 'cierra', 'atencion', 'atencion'];
const FAREWELL_WORDS = ['gracias', 'listo', 'ok', 'okay', 'okey', 'perfecto', 'chao', 'chau', 'adios', 'adiós', 'bye', 'hasta luego', 'hasta pronto', 'nos vemos', 'todo bien', 'todo ok', 'todo okey'];

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

function formatHora12(h24Str) {
  const [h, m] = h24Str.split(':').map(Number);
  const period = h < 12 ? 'de la mañana' : 'de la tarde';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
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

  if (/^(hola+|ola+|buenas|buenos dias|buenas tardes|buenas noches|menu|menú|inicio)$/.test(t)) return 'greeting';
  if (/^(1|servicio|servicios|catalogo|catalogo de servicios|precios|precio)$/.test(t)) return 'list_services';
  if (hasAnyApproxToken(t, SERVICE_INTENT_WORDS, 2) && hasAnyApproxToken(t, QUESTION_INTENT_WORDS, 1)) return 'list_services';
  if (hasAnyApproxToken(t, RESCHEDULE_WORDS, 2) && /\b(cita|reserva|turno|hora|espacio)\b/.test(t)) return 'reschedule';
  if (/\b(cambiar|mover)\b.*\b(mi|la)\b.*\b(cita|reserva|hora)\b/.test(t)) return 'reschedule';
  if (/^(3|mi cita|mis citas|consultar cita|ver cita)$/.test(t)) return 'my_appointment';
  if (/\b(mi cita|mis citas|cita)\b/.test(t) && (hasAnyApproxToken(t, APPOINTMENT_QUERY_WORDS, 1) || /\bque dia|cuando|a que hora\b/.test(t))) return 'my_appointment';
  if (/^(2|reservar|reserva|agendar|agenda|cita|quiero reservar|quiero agendar)$/.test(t)) return 'book_start';
  if (/\b(quiero|quisiera|deseo|necesito).*\b(reservar|reserva|agendar|agenda|cita)\b/.test(t)) return 'book_start';
  if (/\b(quiero|quisiera|deseo|necesito|hacer|haser)\b/.test(t) && hasAnyApproxToken(t, BOOK_INTENT_WORDS, 2)) return 'book_start';
  if (/\bhacer una reserva\b/.test(t)) return 'book_start';
  if (isExplicitNewBookingRequest(t)) return 'book_start';
  if (hasAnyApproxToken(t, BUSINESS_HOURS_WORDS, 1)) return 'business_hours';
  if (FAREWELL_WORDS.some((phrase) => t === normalizeSearchText(phrase) || t.includes(normalizeSearchText(phrase)))) return 'farewell';
  if (/^(4|humano|asesor|asesora|recepcion|recepción|persona|hablar con recepcion|hablar con recepción)$/.test(t)) return 'escalate';
  return null;
}

function wantsCatalogInText(text, flowState = {}) {
  const t = normalizeSearchText(text);
  if (!t) return false;
  if (hasAnyApproxToken(t, SERVICE_INTENT_WORDS, 2)
    && (hasAnyApproxToken(t, QUESTION_INTENT_WORDS, 1) || hasAnyApproxToken(t, EXPLAIN_INTENT_WORDS, 2))) return true;
  if ((flowState.flow === 'listing_services' || flowState.booking?.step === 'select_service')
    && /\b(que son|de que trata|explica|explicame|cada uno)\b/.test(t)) return true;
  return false;
}

function wantsCurrentServiceInfo(text) {
  const t = normalizeSearchText(text);
  if (!t) return false;
  return /\b(que es|de que trata|como es|q es|k es|para que)\b/.test(t)
    || (hasAnyApproxToken(t, EXPLAIN_INTENT_WORDS, 2) && hasAnyApproxToken(t, CURRENT_SERVICE_WORDS, 1));
}

function isExplicitNewBookingRequest(text) {
  const t = normalizeSearchText(text);
  return /\b(nueva|nuevo|otra|otro)\s+(cita|reserva|reservacion)\b/.test(t)
    || /\b(quiero|quisiera|deseo|necesito)\b.*\b(nueva|nuevo|otra|otro)\b.*\b(cita|reserva|reservacion)\b/.test(t);
}

function parseRequestedTime(text) {
  const t = normalizeSearchText(text);
  if (!t) return null;
  if (/\b(en la manana|por la manana)\b/.test(t)) return '09:00';
  if (/\b(en la tarde|por la tarde)\b/.test(t)) return '15:00';
  if (/\b(en la noche|por la noche)\b/.test(t)) return '18:00';

  const match = t.match(/\b(?:a\s+las?|para\s+las?|tipo\s+las?)\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|de la manana|de la tarde|de la noche)?\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3] || '';
  if (hour > 23 || minute > 59) return null;
  if (/p\.?m\.?|tarde|noche/.test(period) && hour < 12) hour += 12;
  else if (/a\.?m\.?|manana/.test(period) && hour === 12) hour = 0;
  else if (!period && hour >= 1 && hour <= 7) hour += 12;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function asksCurrentAppointmentDetails(text) {
  const t = normalizeSearchText(text);
  return /\b(para que dia esta|que dia es|cuando es|a que hora es|cuando tengo|cual es mi cita)\b/.test(t);
}

function wantsSameAppointmentTime(text) {
  const t = normalizeSearchText(text);
  return /\b(la misma hora|mismo horario|misma hora|igual hora)\b/.test(t);
}

function formatAppointmentDate(startsAt) {
  return capitalize(new Intl.DateTimeFormat('es-EC', {
    timeZone: menus.SPA_TZ, weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(startsAt)));
}

function formatAppointmentTime(startsAt) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: menus.SPA_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(startsAt));
}

function isExplicitServiceChoice(text, service) {
  const query = normalizeSearchText(text);
  const name = normalizeSearchText(service?.name);
  if (!query || !name) return false;
  const maxWords = tokenizeForMatch(name).length + 2;
  return query === name || (query.includes(name) && tokenizeForMatch(query).length <= maxWords);
}

function hasExplicitBookingLanguage(text) {
  const t = normalizeSearchText(text);
  return hasAnyApproxToken(t, BOOK_INTENT_WORDS, 2)
    || /\b(quiero|quisiera|deseo|necesito)\b.*\b(agendar|reservar|una cita)\b/.test(t);
}

function describesWellnessNeed(text) {
  const t = normalizeSearchText(text);
  return /\b(me duele|dolor|molestia|tension|tenso|contractura|cansancio|estres|ansiedad)\b/.test(t);
}

function normalizeSearchText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForMatch(text) {
  return normalizeSearchText(text)
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function levenshteinDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  const cur = Array(right.length + 1);
  for (let i = 1; i <= left.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j++) prev[j] = cur[j];
  }
  return prev[right.length];
}

function tokenLooksLike(token, target, maxDistance = 1) {
  const a = normalizeSearchText(token).replace(/[^a-z0-9ñ]/g, '');
  const b = normalizeSearchText(target).replace(/[^a-z0-9ñ]/g, '');
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length <= 2 || b.length <= 2) return false;
  const tolerance = Math.min(maxDistance, b.length <= 5 ? 1 : 2);
  return levenshteinDistance(a, b) <= tolerance;
}

function hasAnyApproxToken(text, targets, maxDistance = 1) {
  const tokens = tokenizeForMatch(text);
  return targets.some((target) => tokens.some((token) => tokenLooksLike(token, target, maxDistance)));
}

function serviceMatchScore(query, serviceName) {
  const q = normalizeSearchText(query);
  const name = normalizeSearchText(serviceName);
  if (!q || !name) return 0;
  if (name.includes(q) || q.includes(name)) return 1;

  const queryTokens = tokenizeForMatch(q).filter((token) => token.length > 2);
  const nameTokens = tokenizeForMatch(name).filter((token) => token.length > 2);
  if (!queryTokens.length || !nameTokens.length) return 0;

  const matched = nameTokens.filter((nameToken) => (
    queryTokens.some((queryToken) => tokenLooksLike(queryToken, nameToken, nameToken.length <= 6 ? 1 : 2))
  )).length;
  return matched / nameTokens.length;
}

function localDateParts(referenceDate = new Date(), timeZone = menus.SPA_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(referenceDate);
  const pick = (type) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
  };
}

function isoFromParts(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function addDaysToISO(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function normalizeYear(yearText, currentYear) {
  if (!yearText) return currentYear;
  const raw = Number(yearText);
  if (!Number.isInteger(raw)) return currentYear;
  return raw < 100 ? 2000 + raw : raw;
}

function resolveCalendarDate(rawDateText, { referenceDate = new Date(), timeZone = menus.SPA_TZ } = {}) {
  const raw = normalizeSearchText(rawDateText);
  if (!raw) return null;

  const todayParts = localDateParts(referenceDate, timeZone);
  const todayISO = isoFromParts(todayParts.year, todayParts.month, todayParts.day);
  const todayUTC = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day));

  if (/\bpasado manana\b/.test(raw)) return addDaysToISO(todayISO, 2);
  if (/\bmanana\b/.test(raw)) return addDaysToISO(todayISO, 1);
  if (/\bhoy\b/.test(raw)) return todayISO;

  const weekdayMatch = raw.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (weekdayMatch) {
    const targetDay = WEEKDAY_INDEX[weekdayMatch[1]];
    const currentDay = todayUTC.getUTCDay();
    const delta = (targetDay - currentDay + 7) % 7;
    return addDaysToISO(todayISO, delta);
  }

  const slashMatch = raw.match(/\b(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?\b/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    let year = normalizeYear(slashMatch[3], todayParts.year);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    let candidate = isoFromParts(year, month, day);
    if (!slashMatch[3] && candidate < todayISO) {
      year += 1;
      candidate = isoFromParts(year, month, day);
    }
    return candidate;
  }

  const namedMonthMatch = raw.match(/\b(?:el\s+)?(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{2,4}))?\b/);
  if (namedMonthMatch) {
    const day = Number(namedMonthMatch[1]);
    const month = MONTH_INDEX[namedMonthMatch[2]];
    let year = normalizeYear(namedMonthMatch[3], todayParts.year);
    if (!month || day < 1 || day > daysInMonth(year, month)) return null;
    let candidate = isoFromParts(year, month, day);
    if (!namedMonthMatch[3] && candidate < todayISO) {
      year += 1;
      candidate = isoFromParts(year, month, day);
    }
    return candidate;
  }

  const bareDayMatch = raw.match(/^(?:el\s+)?(\d{1,2})$/) || raw.match(/\bel\s+(\d{1,2})\b/);
  if (bareDayMatch) {
    const day = Number(bareDayMatch[1]);
    let year = todayParts.year;
    let month = todayParts.month;
    if (day < 1 || day > 31) return null;
    if (day > daysInMonth(year, month)) return null;
    let candidate = isoFromParts(year, month, day);
    if (candidate < todayISO) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      if (day > daysInMonth(year, month)) return null;
      candidate = isoFromParts(year, month, day);
    }
    return candidate;
  }

  return null;
}

function extractRawDateText(text) {
  const raw = normalizeSearchText(text);
  if (!raw) return null;
  const relative = raw.match(/\bpasado manana\b|\bmanana\b|\bhoy\b/);
  if (relative) return relative[0];
  const weekday = raw.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (weekday) return weekday[0];
  const slashDate = raw.match(/\b\d{1,2}\s*[/-]\s*\d{1,2}(?:\s*[/-]\s*\d{2,4})?\b/);
  if (slashDate) return slashDate[0];
  const namedDate = raw.match(/\b(?:el\s+)?\d{1,2}\s+de\s+[a-z]+(?:\s+de\s+\d{2,4})?\b/);
  if (namedDate) return namedDate[0];
  const bareDay = raw.match(/\bel\s+\d{1,2}\b/);
  if (bareDay) return bareDay[0];
  return null;
}

function resolveBookingDate(params = {}, userMessage = null, options = {}) {
  const rawDateText = params.date_text
    || params.dateText
    || params.date_raw
    || params.dateRaw
    || params.raw_date
    || params.rawDate
    || extractRawDateText(userMessage);
  return resolveCalendarDate(rawDateText, options);
}

function isBotVisibleService(service) {
  const category = normalizeSearchText(service?.category);
  const name = normalizeSearchText(service?.name);
  return service?.active !== false
    && !menus.HIDDEN_CATEGORIES.has(category)
    && !HIDDEN_SERVICE_NAMES.has(name);
}

async function loadVisibleServicesForBot(tenantId, { category } = {}) {
  const where = { tenantId, active: true };
  if (category) where.category = category;
  const services = await prisma.service.findMany({
    where,
    select: { id: true, name: true, category: true, priceUsd: true, durationMins: true, description: true, active: true },
    orderBy: category ? { name: 'asc' } : [{ category: 'asc' }, { name: 'asc' }],
  });
  const visible = services.filter(isBotVisibleService);
  if (category) {
    const expected = String(category);
    return visible.filter((service) => String(service.category || '') === expected);
  }
  return visible;
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
  return loadVisibleServicesForBot(tenantId);
}

async function matchServiceByQuery(tenantId, query) {
  if (!query) return null;
  const q = normalizeSearchText(query);
  if (!q) return null;
  const services = await loadVisibleServicesForBot(tenantId);
  const direct = services.find(s => normalizeSearchText(s.name).includes(q))
    || services.find(s => q.includes(normalizeSearchText(s.name)))
    || services.find(s => q.includes(normalizeSearchText(s.name).slice(0, 6)));
  if (direct) return direct;

  const scored = services
    .map((service) => ({ service, score: serviceMatchScore(q, service.name) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 0.6 ? scored[0].service : null;
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
      const warn = '😅 *Un momento, por favor* — ya te respondo 💛';
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

  if (incoming.type === 'audio') {
    const msg = tone === 'tu'
      ? '🌿 Disculpa, todavía no puedo escuchar notas de voz. ¿Me lo escribes? Así te ayudo enseguida 💛'
      : '🌿 Disculpe, todavía no puedo escuchar notas de voz. ¿Me lo escribe? Así le ayudo enseguida 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return;
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
  const priorityIntent = detectDeterministicIntent(bodyText);

  // La petición nueva y explícita de la clienta manda sobre cualquier flujo previo.
  if (priorityIntent === 'book_start') {
    await logBotInteraction(tenant.id, conv, { userMessage: bodyText, intent: priorityIntent, reply: null });
    return routeIntent({ tenant, connection, conv, waId, tone, intent: priorityIntent, userMessage: bodyText });
  }

  const requestedDate = resolveBookingDate({}, bodyText);
  const requestedTime = parseRequestedTime(bodyText);
  if (flowState.reschedule?.step === 'select_date' && asksCurrentAppointmentDetails(bodyText)) {
    return sendRescheduleCurrentAppointment({ tenant, connection, conv, waId, tone, reschedule: flowState.reschedule });
  }
  const rescheduleTime = requestedTime || (
    flowState.reschedule && wantsSameAppointmentTime(bodyText) ? flowState.reschedule.currentTime : null
  );
  if (flowState.reschedule?.step === 'select_date' && requestedDate) {
    return handleRescheduleDateSelected({ tenant, connection, conv, waId, tone, date: requestedDate, requestedTime: rescheduleTime });
  }
  if (flowState.reschedule?.step === 'select_time' && rescheduleTime) {
    const slotIndex = findSlotIndexByTime(flowState.reschedule.availableSlots, rescheduleTime);
    if (slotIndex >= 0) return handleRescheduleTimeSelected({ tenant, connection, conv, waId, tone, slotIndex });
  }
  if (flowState.booking?.step === 'select_date' && requestedDate) {
    return handleBookingDateSelected({ tenant, connection, conv, waId, tone, date: requestedDate, requestedTime });
  }
  if (flowState.booking?.step === 'select_time' && requestedTime) {
    const slotIndex = findSlotIndexByTime(flowState.booking.availableSlots, requestedTime);
    if (slotIndex >= 0) return handleBookingTimeSelected({ tenant, connection, conv, waId, tone, slotIndex });
  }

  if (flowState.booking?.serviceId && wantsCurrentServiceInfo(bodyText)) {
    return handleBookingServiceInfo({ tenant, connection, conv, waId, tone, serviceId: flowState.booking.serviceId });
  }

  if (wantsCatalogInText(bodyText, flowState)) {
    await logBotInteraction(tenant.id, conv, {
      userMessage: bodyText,
      intent: 'list_services',
      reply: null,
    });
    return handleListServices({ tenant, connection, conv, waId, tone, asText: true });
  }

  // If we're in a booking flow and user sends text, handle contextually
  if (flowState.booking?.step === 'ask_name') {
    return handleNameCapture({ tenant, connection, conv, waId, tone, name: bodyText });
  }

  if (flowState.booking?.step === 'confirm') {
    if (!flowState.booking.serviceId || !flowState.booking.timeSlot || !flowState.booking.clientName) {
      return handleBook({ tenant, connection, conv, waId, tone });
    }
    const norm = bodyText.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/(.)\1+$/g, '$1');
    const YES = ['confirmo', 'confirmar', 'si', 'si confirmo', 'ok', 'dale', 'listo', 'de acuerdo', 'perfecto', 'bueno', 'ya'];
    const NO = ['no', 'cancelar', 'no gracias', 'mejor no', 'cancelo'];
    if (YES.includes(norm)) {
      return handleBookingConfirm({ tenant, connection, conv, waId, tone });
    }
    if (NO.includes(norm)) {
      const prev = state.getFlowState(waId) || {};
      state.setFlowState(waId, { flow: 'menu', booking: null, clientName: prev.clientName, tone, unclearCount: 0 });
      const msg = tone === 'tu'
        ? '🌿 *Sin problema, cancelé tu reserva*\n\n¿Te ayudo con algo más?'
        : '🌿 *Sin problema, cancelé su reserva*\n\n¿Le ayudo con algo más?';
      const r = await transport.sendText(connection, waId, msg);
      await recordBotMessage(tenant.id, conv, r, { body: msg });
      return sendMainMenu({ tenant, connection, conv, waId, tone });
    }
  }

  if (flowState.booking && flowState.booking.step !== 'ask_name') {
    const requestedService = await matchServiceByQuery(tenant.id, bodyText);
    if (requestedService && isExplicitServiceChoice(bodyText, requestedService)) {
      return handleBookingServiceSelected({ tenant, connection, conv, waId, tone, serviceId: requestedService.id });
    }
  }

  const deterministicIntent = priorityIntent;
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
    return routeIntent({ tenant, connection, conv, waId, tone, intent: deterministicIntent, userMessage: bodyText });
  }

  // Tier 2: intent cache lookup
  const canUseIntentCache = !flowState.booking && !flowState.reschedule && flowState.flow !== 'service_detail';
  const cached = canUseIntentCache ? intentCache.get(bodyText) : null;
  if (cached) {
    logBot('info', 'intención resuelta por caché', {
      tenant: tenant.slug,
      conversationId: conv.id,
      intent: cached.intent,
    });
    await logBotInteraction(tenant.id, conv, {
      userMessage: bodyText, intent: cached.intent, reply: cached.reply,
    });
    return routeIntent({ tenant, connection, conv, waId, tone, intent: cached.intent, aiReply: cached.reply, userMessage: bodyText });
  }

  // Tier 3: AI (if available)
  if (!aiClient.isAvailable()) {
    logBot('info', 'IA no configurada; enviando menú base', {
      tenant: tenant.slug,
      conversationId: conv.id,
    });
    if (flowState.flow) {
      const hint = tone === 'tu'
        ? '🤔 *No entendí tu mensaje* — te muestro las opciones:'
        : '🤔 *No entendí su mensaje* — le muestro las opciones:';
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

  if (canUseIntentCache) intentCache.set(bodyText, aiResult.intent, aiResult.replyText);

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
    userMessage: bodyText,
  });
}

// ─── Intent router ─────────────────────────────────────────────

async function routeIntent({ tenant, connection, conv, waId, tone, intent, aiReply, params, userMessage }) {
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
      return handleListServices({
        tenant,
        connection,
        conv,
        waId,
        tone,
        asText: wantsCatalogInText(userMessage, state.getFlowState(waId) || {}),
      });

    case 'book':
    case 'book_start':
      return handleBook({ tenant, connection, conv, waId, tone, aiReply });

    case 'book_service': {
      if (params?.service_query) {
        const svc = await matchServiceByQuery(tenant.id, params.service_query);
        if (svc) {
          // Un síntoma no es consentimiento para reservar: primero se informa
          // y se conserva el flujo que la clienta ya estaba siguiendo.
          if (describesWellnessNeed(userMessage) && !hasExplicitBookingLanguage(userMessage)) {
            const fs = state.getFlowState(waId) || {};
            if (fs.booking) return sendBookingServiceInfo({ tenant, connection, conv, waId, tone, service: svc });
            return handleServiceDetail({ tenant, connection, conv, waId, tone, serviceId: svc.id });
          }
          const resolvedDate = resolveBookingDate(params, userMessage);
          if (resolvedDate) {
            return handleSmartBooking({ tenant, connection, conv, waId, tone, service: svc, date: resolvedDate, time: params.time || null, aiReply });
          }
          return handleBookingServiceSelected({ tenant, connection, conv, waId, tone, serviceId: svc.id });
        }
      }
      return handleBook({ tenant, connection, conv, waId, tone, aiReply });
    }

    case 'my_appointment':
    case 'cancel':
      return handleMyAppointment({ tenant, connection, conv, waId, tone });

    case 'reschedule': {
      const date = resolveBookingDate(params, userMessage);
      return handleReschedule({
        tenant, connection, conv, waId, tone, date,
        time: params?.time || null,
        keepCurrentTime: wantsSameAppointmentTime(userMessage),
      });
    }

    case 'business_hours':
      return handleBusinessHours({ tenant, connection, conv, waId, tone });

    case 'farewell':
      return handleFarewell({ tenant, connection, conv, waId, tone });

    case 'escalate':
      return handleEscalate({ tenant, connection, conv, waId, tone });

    case 'service_info':
    case 'suggest_service': {
      if (params?.service_query) {
        const svc = await matchServiceByQuery(tenant.id, params.service_query);
        if (svc) {
          const fs = state.getFlowState(waId) || {};
          if (fs?.booking) {
            return sendBookingServiceInfo({ tenant, connection, conv, waId, tone, service: svc });
          }
          return handleServiceDetail({ tenant, connection, conv, waId, tone, serviceId: svc.id });
        }
      }
      if (aiReply) {
        const r = await transport.sendText(connection, waId, aiReply);
        await recordBotMessage(tenant.id, conv, r, { body: aiReply });
        return;
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

function serviceCatalogDescription(service) {
  const description = String(service.description || '').replace(/\s+/g, ' ').trim();
  if (description) return description.slice(0, 180);
  return null;
}

function serviceInfoFallback(service) {
  const name = normalizeSearchText(service?.name);
  if (name.includes('masaje')) return 'Es un espacio de bienestar corporal pensado para descansar y relajarte.';
  if (name.includes('facial')) return 'Es un servicio de cuidado facial y bienestar.';
  if (name.includes('yoga')) return 'Es una práctica de movimiento y bienestar guiado.';
  return 'Es un servicio de bienestar de Alma Spa. Recepción puede ampliarte los detalles específicos.';
}

function findSlotIndexByTime(slots, requestedTime) {
  return (slots || []).findIndex((iso) => new Intl.DateTimeFormat('en-GB', {
    timeZone: menus.SPA_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso)) === requestedTime);
}

function serviceCatalogMeta(service) {
  const duration = `${service.durationMins || 60} min`;
  const price = Number(service.priceUsd || 0);
  if (price > 0) return `$${price.toFixed(2)} · ${duration}`;
  return `valor a confirmar · ${duration}`;
}

function buildServicesCatalogText(services, { tone } = {}) {
  const byCat = new Map();
  for (const service of services) {
    const category = String(service.category || 'Otros');
    if (!byCat.has(category)) byCat.set(category, []);
    byCat.get(category).push(service);
  }

  const lines = ['🌿 *Estos son nuestros servicios*'];

  for (const [category, items] of [...byCat.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`\n*${menus.categoryDisplayName(category)}*`);
    for (const service of items.sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
      lines.push(`• _${service.name}_ — ${serviceCatalogMeta(service)}`);
      const description = serviceCatalogDescription(service);
      if (description) lines.push(`  ${description}`);
    }
  }

  lines.push(tone === 'tu'
    ? '\nSi quieres, dime cuál te llama la atención y te cuento más o te ayudo a reservar.'
    : '\nSi desea, dígame cuál le llama la atención y le cuento más o le ayudo a reservar.');

  return lines.join('\n');
}

function splitMessage(text, maxLength = 3500) {
  const chunks = [];
  let current = '';
  for (const block of String(text || '').split('\n\n')) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = block;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function sendTextChunks({ tenant, connection, conv, waId, text }) {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    const r = await transport.sendText(connection, waId, chunk);
    await recordBotMessage(tenant.id, conv, r, { body: chunk });
  }
}

// ─── Core handlers ─────────────────────────────────────────────

async function handleUnclear({ tenant, connection, conv, waId, tone, aiReply }) {
  const flowState = state.getFlowState(waId) || {};
  const unclearCount = (flowState.unclearCount || 0) + 1;
  state.setFlowState(waId, { ...flowState, tone, unclearCount });

  if (unclearCount >= MAX_UNCLEAR_BEFORE_ESCALATE) {
    const msg = tone === 'tu'
      ? '😅 *Te paso con recepción* — para ayudarte mejor 💛'
      : '😅 *Le paso con recepción* — para ayudarle mejor 💛';
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
    const flowState = state.getFlowState(waId);
    if (flowState?.reschedule?.appointmentId) {
      return handleRescheduleDateSelected({ tenant, connection, conv, waId, tone, date });
    }
    return handleBookingDateSelected({ tenant, connection, conv, waId, tone, date });
  }
  if (selectionId.startsWith(menus.BOOK_TIME_PREFIX)) {
    const idx = parseInt(selectionId.slice(menus.BOOK_TIME_PREFIX.length), 10);
    const flowState = state.getFlowState(waId);
    if (flowState?.reschedule?.appointmentId) {
      return handleRescheduleTimeSelected({ tenant, connection, conv, waId, tone, slotIndex: idx });
    }
    return handleBookingTimeSelected({ tenant, connection, conv, waId, tone, slotIndex: idx });
  }
  if (selectionId === menus.BOOK_CONFIRM_YES) {
    return handleBookingConfirm({ tenant, connection, conv, waId, tone });
  }
  if (selectionId === menus.BOOK_CONFIRM_NO) {
    const prev = state.getFlowState(waId) || {};
    state.setFlowState(waId, { flow: 'menu', booking: null, clientName: prev.clientName, tone, unclearCount: 0 });
    const msg = tone === 'tu'
      ? '🌿 *Sin problema, cancelé tu reserva*\n\n¿Te ayudo con algo más?'
      : '🌿 *Sin problema, cancelé su reserva*\n\n¿Le ayudo con algo más?';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }
  if (selectionId === menus.RESCHEDULE_CONFIRM_YES) {
    return handleRescheduleConfirm({ tenant, connection, conv, waId, tone });
  }
  if (selectionId === menus.RESCHEDULE_CONFIRM_NO) {
    const prev = state.getFlowState(waId) || {};
    state.setFlowState(waId, { flow: 'menu', reschedule: null, clientName: prev.clientName, tone, unclearCount: 0 });
    const msg = tone === 'tu'
      ? '🌿 *Dejé tu espacio como estaba*\n\n¿Te ayudo con algo más?'
      : '🌿 *Dejé su espacio como estaba*\n\n¿Le ayudo con algo más?';
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
  if (selectionId === menus.RESCHEDULE_START) {
    return handleReschedule({ tenant, connection, conv, waId, tone });
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

async function handleListServices({ tenant, connection, conv, waId, tone, asText = false }) {
  const svcs = await loadVisibleServicesForBot(tenant.id);
  state.setFlowState(waId, { flow: 'listing_services', tone, unclearCount: 0 });

  const visible = svcs;
  if (asText) {
    const text = buildServicesCatalogText(visible, { tone });
    await sendTextChunks({ tenant, connection, conv, waId, text });
    return;
  }

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
  const svcs = await loadVisibleServicesForBot(tenant.id, { category: categoryName });
  if (svcs.length === 0) {
    const msg = tone === 'tu'
      ? '🤔 *No encontré servicios ahí* — te muestro las opciones:'
      : '🤔 *No encontré servicios ahí* — le muestro las opciones:';
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
      ? '😅 *Ese servicio ya no está disponible*\n\nTe muestro los que tenemos 🌿'
      : '😅 *Ese servicio ya no está disponible*\n\nLe muestro los que tenemos 🌿';
    const rr = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, rr, { body: msg });
    return handleListServices({ tenant, connection, conv, waId, tone });
  }

  const descLine = `\n\n${serviceCatalogDescription(svc) || serviceInfoFallback(svc)}`;
  const caption = `🌿 *_${svc.name}_*\n💰 $${Number(svc.priceUsd).toFixed(2)} · ${svc.durationMins || 60} min${descLine}`;

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

async function handleBookingServiceInfo({ tenant, connection, conv, waId, tone, serviceId }) {
  const botActor = { id: 'bot', role: 'dueno', tenantId: tenant.id, email: 'bot@internal' };
  const svc = await serviceService.getService(botActor, serviceId);
  if (!svc || svc.active === false) {
    return handleBook({ tenant, connection, conv, waId, tone });
  }

  return sendBookingServiceInfo({ tenant, connection, conv, waId, tone, service: svc });
}

async function sendBookingServiceInfo({ tenant, connection, conv, waId, tone, service }) {
  const msg = tone === 'tu'
    ? `🌿 *_${service.name}_*\n${serviceCatalogDescription(service) || serviceInfoFallback(service)}\n\n${serviceCatalogMeta(service)}\n\nCuando quieras, dime qué día te queda bien.`
    : `🌿 *_${service.name}_*\n${serviceCatalogDescription(service) || serviceInfoFallback(service)}\n\n${serviceCatalogMeta(service)}\n\nCuando desee, dígame qué día le queda bien.`;
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
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
  const visible = await loadVisibleServicesForBot(tenant.id);
  if (visible.length === 0) {
    const msg = tone === 'tu'
      ? '😅 *Aún no tenemos servicios disponibles*\n\nComunícate con recepción 💛'
      : '😅 *Aún no tenemos servicios disponibles*\n\nComuníquese con recepción 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  const prev = state.getFlowState(waId) || {};
  state.setFlowState(waId, { flow: 'booking', booking: { step: 'select_service' }, clientName: prev.clientName, tone, unclearCount: 0 });

  const intro = aiReply || (tone === 'tu'
    ? '✨ *¡Qué lindo que quieres darte un momento!*\n\nElige tu servicio:'
    : '✨ *¡Qué lindo que desea darse un momento!*\n\nElija su servicio:');

  const categories = buildVisibleCategories(visible);
  if (categories.length > 1) {
    const payload = menus.categoryList(categories, { tone, body: intro });
    const r = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[${categories.length} categorías para reserva]` });
  } else {
    const payload = menus.servicesList(visible, { tone, body: intro });
    const r = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: '[selección de servicio para reserva]' });
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
    const body = `😔 *No hay horarios ese día* para _${service.name}_\n\n¿Probamos otro día?`;
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

    const body = `😅 *No hay horario a las ${time}* para _${service.name}_\n\nPero tengo estos:`;
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
      ? '😅 *Ese servicio ya no está disponible*\n\nElige otro:'
      : '😅 *Ese servicio ya no está disponible*\n\nElija otro:';
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
    ? `✨ *_${svc.name}_ — excelente elección*\n\n¿Qué día te queda bien?`
    : `✨ *_${svc.name}_ — excelente elección*\n\n¿Qué día le queda bien?`;
  const payload = menus.datePicker({ tone, body });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[fecha para ${svc.name}]` });
}

async function handleBookingDateSelected({ tenant, connection, conv, waId, tone, date, requestedTime = null }) {
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
    const msg = '😅 *Hubo un problema al buscar horarios*\n\nProbemos de nuevo:';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    const dp = menus.datePicker({ tone });
    const r2 = await transport.sendInteractive(connection, waId, dp);
    await recordBotMessage(tenant.id, conv, r2, { type: 'interactive', body: '[selección de fecha]' });
    return;
  }

  if (slots.length === 0) {
    const msg = '😔 *No hay horarios ese día*\n\n¿Probamos otro?';
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

  if (requestedTime) {
    const slotIndex = findSlotIndexByTime(slots, requestedTime);
    if (slotIndex >= 0) return handleBookingTimeSelected({ tenant, connection, conv, waId, tone, slotIndex });
  }

  const payload = slots.length <= 3
    ? menus.timeSlotButtons(slots, fs.booking.serviceName, { tone })
    : menus.timeSlotList(slots, fs.booking.serviceName, {
      tone,
      body: requestedTime ? `😅 *No hay horario a las ${requestedTime}*\n\nPero tengo estos:` : undefined,
    });
  if (requestedTime && slots.length <= 3) {
    payload.body = { text: `😅 *No hay horario a las ${requestedTime}*\n\nPero tengo estos:` };
  }
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
      ? '😅 *Ese horario ya no está disponible*\n\nElige otro:'
      : '😅 *Ese horario ya no está disponible*\n\nElija otro:';
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
      ? '💛 *Escribe tu nombre completo*, por favor'
      : '💛 *Escriba su nombre completo*, por favor';
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

  const summary = `🌿 _${booking.serviceName}_\n📅 ${capitalize(fechaStr)}\n🕐 ${formatHora12(horaStr)}\n👤 ${clientName}`;

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
    let appointment;
    await prisma.$transaction(async (tx) => {
      const client = await clientService.upsertClient(tx, tenant.id, {
        fullName: booking.clientName,
        whatsapp: phone,
      });

      const tenantData = await tx.tenant.findUnique({ where: { id: tenant.id }, select: { config: true } });

      appointment = await appointmentService.resolveAndCreateAppointment(tx, {
        tenantId: tenant.id,
        tenantConfig: tenantData?.config,
        clientId: client.id,
        serviceId: booking.serviceId,
        startsAt: new Date(booking.timeSlot),
        modality: 'spa',
        status: 'pendiente_bot',
      });
    });

    if (!appointment?.id) {
      throw new Error('No se pudo crear la cita');
    }

    const slotDate = new Date(booking.timeSlot);
    const TZ = menus.SPA_TZ;
    const fechaStr = new Intl.DateTimeFormat('es-EC', {
      timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
    }).format(slotDate);
    const horaStr = new Intl.DateTimeFormat('es-EC', {
      timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(slotDate);

    const msg = tone === 'tu'
      ? `✨ *Listo, ${booking.clientName} — tu espacio está reservado*\n\n🌿 _${booking.serviceName}_\n📅 ${capitalize(fechaStr)}\n🕐 ${formatHora12(horaStr)}\n\nTe esperamos con mucho cariño 💛`
      : `✨ *Listo, ${booking.clientName} — su espacio está reservado*\n\n🌿 _${booking.serviceName}_\n📅 ${capitalize(fechaStr)}\n🕐 ${formatHora12(horaStr)}\n\nLe esperamos con mucho cariño 💛`;
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });

    state.setFlowState(waId, { flow: 'menu', booking: null, clientName: booking.clientName, tone, unclearCount: 0 });

  } catch (err) {
    logBot('warn', 'error al crear reserva', { error: err.message, serviceId: booking.serviceId });

    if (err instanceof SlotUnavailableError) {
      const msg = '😔 *Ese horario se acaba de ocupar*\n\n¿Probamos otro momento?';
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
        ? '😅 *Tuve un problema con tu reserva*\n\nTe paso con recepción 💛'
        : '😅 *Tuve un problema con su reserva*\n\nLe paso con recepción 💛';
      const r = await transport.sendText(connection, waId, msg);
      await recordBotMessage(tenant.id, conv, r, { body: msg });

      return handleEscalate({ tenant, connection, conv, waId, tone });
    }
  }
}

// ─── Reprogramación de cita ─────────────────────────────────────

async function handleReschedule({ tenant, connection, conv, waId, tone, date = null, time = null, keepCurrentTime = false }) {
  const phone = waIdToPhone(waId);
  const client = await prisma.client.findFirst({ where: { tenantId: tenant.id, whatsapp: phone } });
  if (!client) {
    const msg = tone === 'tu'
      ? '🤔 *No encontré una reserva próxima a tu nombre*\n\n¿Quieres agendar tu momento? 💛'
      : '🤔 *No encontré una reserva próxima a su nombre*\n\n¿Desea agendar su momento? 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  const appointment = await prisma.appointment.findFirst({
    where: {
      tenantId: tenant.id,
      clientId: client.id,
      status: { in: ['pendiente', 'pendiente_bot', 'confirmado'] },
      startsAt: { gte: new Date() },
    },
    orderBy: { startsAt: 'asc' },
    include: { service: true },
  });
  if (!appointment) {
    const msg = tone === 'tu'
      ? '📋 *No tienes reservas próximas para cambiar*\n\n¿Quieres agendar tu momento? 💛'
      : '📋 *No tiene reservas próximas para cambiar*\n\n¿Desea agendar su momento? 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  state.setFlowState(waId, {
    flow: 'reschedule',
    reschedule: {
      step: 'select_date',
      appointmentId: appointment.id,
      serviceName: appointment.service?.name || 'tu servicio',
      currentStartsAt: new Date(appointment.startsAt).toISOString(),
      currentTime: formatAppointmentTime(appointment.startsAt),
    },
    clientName: client.fullName,
    tone,
    unclearCount: 0,
  });

  if (date) {
    return handleRescheduleDateSelected({
      tenant, connection, conv, waId, tone, date,
      requestedTime: time || (keepCurrentTime ? formatAppointmentTime(appointment.startsAt) : null),
    });
  }

  const currentDate = formatAppointmentDate(appointment.startsAt);
  const currentTime = formatAppointmentTime(appointment.startsAt);
  const body = tone === 'tu'
    ? `📅 *Vamos a reprogramar tu espacio de* _${appointment.service?.name || 'Alma Spa'}_\n\nTu cita actual es el ${currentDate} a las ${formatHora12(currentTime)}.\n\n¿Qué día te queda bien? También puedes decir “el miércoles a la misma hora”.`
    : `📅 *Vamos a reprogramar su espacio de* _${appointment.service?.name || 'Alma Spa'}_\n\nSu cita actual es el ${currentDate} a las ${formatHora12(currentTime)}.\n\n¿Qué día le queda bien? También puede decir “el miércoles a la misma hora”.`;
  const payload = menus.datePicker({ tone, body });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: '[reprogramar: selección de fecha]' });
}

async function sendRescheduleCurrentAppointment({ tenant, connection, conv, waId, tone, reschedule }) {
  if (!reschedule?.currentStartsAt) return handleReschedule({ tenant, connection, conv, waId, tone });
  const message = tone === 'tu'
    ? `📋 *Tu cita actual*\n\n🌿 _${reschedule.serviceName}_\n📅 ${formatAppointmentDate(reschedule.currentStartsAt)}\n🕐 ${formatHora12(formatAppointmentTime(reschedule.currentStartsAt))}\n\nDime el nuevo día y hora; por ejemplo: “el miércoles a la misma hora”.`
    : `📋 *Su cita actual*\n\n🌿 _${reschedule.serviceName}_\n📅 ${formatAppointmentDate(reschedule.currentStartsAt)}\n🕐 ${formatHora12(formatAppointmentTime(reschedule.currentStartsAt))}\n\nDígame el nuevo día y hora; por ejemplo: “el miércoles a la misma hora”.`;
  const r = await transport.sendText(connection, waId, message);
  await recordBotMessage(tenant.id, conv, r, { body: message });
}

async function handleRescheduleDateSelected({ tenant, connection, conv, waId, tone, date, requestedTime = null }) {
  const fs = state.getFlowState(waId);
  if (!fs?.reschedule?.appointmentId) {
    return handleReschedule({ tenant, connection, conv, waId, tone });
  }

  let slots;
  try {
    const tenantData = await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { config: true } });
    slots = await appointmentService.getRescheduleAvailability({
      tenantId: tenant.id,
      tenantConfig: tenantData?.config,
      appointmentId: fs.reschedule.appointmentId,
      date,
    });
  } catch (err) {
    logBot('warn', 'error al buscar horarios para reprogramar', { error: err.message, date });
    const msg = '😅 *Hubo un problema al buscar horarios*\n\nProbemos de nuevo:';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    const payload = menus.datePicker({ tone });
    const r2 = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r2, { type: 'interactive', body: '[reprogramar: selección de fecha]' });
    return;
  }

  if (slots.length === 0) {
    const msg = tone === 'tu'
      ? '😔 *No hay horarios ese día para tu espacio*\n\n¿Probamos otro?'
      : '😔 *No hay horarios ese día para su espacio*\n\n¿Probamos otro?';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    const payload = menus.datePicker({ tone });
    const r2 = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r2, { type: 'interactive', body: '[reprogramar: otro día]' });
    return;
  }

  state.setFlowState(waId, {
    flow: 'reschedule',
    reschedule: { ...fs.reschedule, step: 'select_time', date, availableSlots: slots },
    clientName: fs.clientName,
    tone,
    unclearCount: 0,
  });

  if (requestedTime) {
    const idx = slots.findIndex((iso) => new Intl.DateTimeFormat('en-GB', {
      timeZone: menus.SPA_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso)) === requestedTime);
    if (idx >= 0) return handleRescheduleTimeSelected({ tenant, connection, conv, waId, tone, slotIndex: idx });
  }

  const body = requestedTime
    ? `😅 *No hay horario a las ${requestedTime}*\n\nPero tengo estos:`
    : undefined;
  const payload = slots.length <= 3
    ? menus.timeSlotButtons(slots, fs.reschedule.serviceName, { tone })
    : menus.timeSlotList(slots, fs.reschedule.serviceName, { tone, body });
  if (body && slots.length <= 3) payload.body = { text: body };
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[reprogramar: ${slots.length} horarios para ${date}]` });
}

async function handleRescheduleTimeSelected({ tenant, connection, conv, waId, tone, slotIndex }) {
  const fs = state.getFlowState(waId);
  const reschedule = fs?.reschedule;
  if (!reschedule?.appointmentId || !reschedule?.availableSlots) {
    return handleReschedule({ tenant, connection, conv, waId, tone });
  }
  const slot = reschedule.availableSlots[slotIndex];
  if (!slot) return handleRescheduleDateSelected({ tenant, connection, conv, waId, tone, date: reschedule.date });

  state.setFlowState(waId, {
    flow: 'reschedule',
    reschedule: { ...reschedule, step: 'confirm', timeSlot: slot },
    clientName: fs.clientName,
    tone,
    unclearCount: 0,
  });
  return showRescheduleConfirmation({ tenant, connection, conv, waId, tone });
}

async function showRescheduleConfirmation({ tenant, connection, conv, waId, tone }) {
  const fs = state.getFlowState(waId);
  const reschedule = fs?.reschedule;
  if (!reschedule?.appointmentId || !reschedule?.timeSlot) {
    return handleReschedule({ tenant, connection, conv, waId, tone });
  }
  const slot = new Date(reschedule.timeSlot);
  const fecha = new Intl.DateTimeFormat('es-EC', {
    timeZone: menus.SPA_TZ, weekday: 'long', day: 'numeric', month: 'long',
  }).format(slot);
  const hora = new Intl.DateTimeFormat('es-EC', {
    timeZone: menus.SPA_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(slot);
  const summary = `🌿 _${reschedule.serviceName}_\n📅 ${capitalize(fecha)}\n🕐 ${formatHora12(hora)}`;
  const payload = menus.rescheduleConfirmation(summary, { tone });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[confirmación de reprogramar: ${reschedule.serviceName}]` });
}

async function handleRescheduleConfirm({ tenant, connection, conv, waId, tone }) {
  const fs = state.getFlowState(waId);
  const reschedule = fs?.reschedule;
  if (!reschedule?.appointmentId || !reschedule?.timeSlot) {
    return handleReschedule({ tenant, connection, conv, waId, tone });
  }

  try {
    const botActor = { id: 'bot', role: 'dueno', tenantId: tenant.id, email: 'bot@internal' };
    await appointmentService.updateAppointment(botActor, reschedule.appointmentId, { startsAt: reschedule.timeSlot });
    const slot = new Date(reschedule.timeSlot);
    const fecha = new Intl.DateTimeFormat('es-EC', {
      timeZone: menus.SPA_TZ, weekday: 'long', day: 'numeric', month: 'long',
    }).format(slot);
    const hora = new Intl.DateTimeFormat('es-EC', {
      timeZone: menus.SPA_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(slot);
    const msg = tone === 'tu'
      ? `✨ *Listo, actualicé tu espacio*\n\n🌿 _${reschedule.serviceName}_\n📅 ${capitalize(fecha)}\n🕐 ${formatHora12(hora)}\n\nTe esperamos con mucho cariño 💛`
      : `✨ *Listo, actualicé su espacio*\n\n🌿 _${reschedule.serviceName}_\n📅 ${capitalize(fecha)}\n🕐 ${formatHora12(hora)}\n\nLe esperamos con mucho cariño 💛`;
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    state.setFlowState(waId, { flow: 'menu', reschedule: null, clientName: fs.clientName, tone, unclearCount: 0 });
  } catch (err) {
    logBot('warn', 'error al reprogramar cita', { error: err.message, appointmentId: reschedule.appointmentId });
    if (err instanceof SlotUnavailableError) {
      const msg = '😔 *Ese horario se acaba de ocupar*\n\nVeamos otros disponibles:';
      const r = await transport.sendText(connection, waId, msg);
      await recordBotMessage(tenant.id, conv, r, { body: msg });
      return handleRescheduleDateSelected({ tenant, connection, conv, waId, tone, date: reschedule.date });
    }
    return handleEscalate({ tenant, connection, conv, waId, tone });
  }
}

// ─── Other handlers ────────────────────────────────────────────

async function handleMyAppointment({ tenant, connection, conv, waId, tone }) {
  const phone = waIdToPhone(waId);
  const client = await prisma.client.findFirst({ where: { tenantId: tenant.id, whatsapp: phone } });
  if (!client) {
    const msg = tone === 'tu'
      ? '🤔 *No encontré reservas a tu nombre*\n\n¿Quieres agendar tu momento? 💛'
      : '🤔 *No encontré reservas a su nombre*\n\n¿Desea agendar su momento? 💛';
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
      ? '📋 *No tienes reservas próximas*\n\n¿Quieres agendar tu momento? 💛'
      : '📋 *No tiene reservas próximas*\n\n¿Desea agendar su momento? 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  const fecha = new Date(next.startsAt).toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil', weekday: 'long', day: '2-digit', month: 'long',
    hour: '2-digit', minute: '2-digit',
  });
  const estado = (next.status === 'confirmado' || next.status === 'pendiente_bot') ? 'confirmada' : 'pendiente de confirmar';
  const msg = tone === 'tu'
    ? `📋 *Tu próximo espacio en Alma Spa*\n\n🌿 _${next.service?.name}_\n📅 ${fecha}\n🏠 Cabina: ${next.room?.name || '—'}\n✅ ${capitalize(estado)}\n\nSi necesitas cambiar algo, avísanos 💛`
    : `📋 *Su próximo espacio en Alma Spa*\n\n🌿 _${next.service?.name}_\n📅 ${fecha}\n🏠 Cabina: ${next.room?.name || '—'}\n✅ ${capitalize(estado)}\n\nSi necesita cambiar algo, avísenos 💛`;
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
  const actions = menus.appointmentActions({ tone });
  const actionResult = await transport.sendInteractive(connection, waId, actions);
  await recordBotMessage(tenant.id, conv, actionResult, { type: 'interactive', body: '[acciones de mi cita]' });
  state.setFlowState(waId, { flow: 'menu', clientName: client.fullName, tone, unclearCount: 0 });
}

async function handleEscalate({ tenant, connection, conv, waId, tone }) {
  state.markEscalated(waId);
  const msg = tone === 'tu'
    ? '👋 *Te paso con recepción*\n\nAlguien te responderá pronto 🌿'
    : '👋 *Le paso con recepción*\n\nAlguien le responderá pronto 🌿';
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
  state.clearFlowState(waId);
}

async function handleBusinessHours({ tenant, connection, conv, waId, tone }) {
  const msg = tone === 'tu'
    ? '🕐 *Nuestro horario de atención*\n\nLunes a sábado:\n🌤️ 9:00 a. m. a 12:00 p. m.\n🌙 3:00 p. m. a 8:00 p. m.\n\nDomingos descansamos 🌿'
    : '🕐 *Nuestro horario de atención*\n\nLunes a sábado:\n🌤️ 9:00 a. m. a 12:00 p. m.\n🌙 3:00 p. m. a 8:00 p. m.\n\nDomingos descansamos 🌿';
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
}

async function handleFarewell({ tenant, connection, conv, waId, tone }) {
  const msg = tone === 'tu'
    ? '✨ *Con mucho gusto*\n\nQue tengas un lindo día 🌿'
    : '✨ *Con mucho gusto*\n\nQue tenga un lindo día 🌿';
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
  const prev = state.getFlowState(waId) || {};
  state.setFlowState(waId, { flow: 'menu', clientName: prev.clientName || null, tone, unclearCount: 0 });
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
    handleBookingServiceInfo,
    handleBook,
    handleSmartBooking,
    handleBookingServiceSelected,
    handleBookingDateSelected,
    handleBookingTimeSelected,
    handleBookingConfirm,
    handleReschedule,
    handleRescheduleDateSelected,
    handleRescheduleTimeSelected,
    handleRescheduleConfirm,
    handleNameCapture,
    showBookingConfirmation,
    handleMyAppointment,
    handleEscalate,
    handleBusinessHours,
    handleFarewell,
    handleTextMessage,
    handleUnclear,
    detectDeterministicIntent,
    routeIntent,
    getDailyCostForConversation,
    logBotInteraction,
    lookupClientByWaId,
    matchServiceByQuery,
    buildVisibleCategories,
    wantsCatalogInText,
    wantsCurrentServiceInfo,
    buildServicesCatalogText,
    normalizeSearchText,
    extractRawDateText,
    resolveCalendarDate,
    resolveBookingDate,
    handleSmartBooking,
  },
};
