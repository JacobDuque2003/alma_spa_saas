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
const { normalizePhone, isValidE164, waIdToPhone } = require('../../utils/phone');
const { SlotUnavailableError } = require('../../utils/errors');
const { normalize: normalizeBusinessHours } = require('../../utils/businessHours');
const { getTenantTimezone } = require('../../utils/timezone');

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
const LOCATION_WORDS = ['donde', 'ubicacion', 'direccion', 'ubican', 'ubicado', 'ubicada', 'llegar', 'llego'];
const FAREWELL_WORDS = ['gracias', 'listo', 'ok', 'okay', 'okey', 'perfecto', 'chao', 'chau', 'adios', 'adiós', 'bye', 'hasta luego', 'hasta pronto', 'nos vemos', 'todo bien', 'todo ok', 'todo okey'];
const RECEPTION_LABEL = 'solicitar_recepcionista';
const WEEKDAY_NAME_TO_INDEX = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sunday: 7,
};

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

async function appendConversationLabels(conv, labels) {
  if (!conv?.id || !Array.isArray(labels) || !labels.length) return;
  try {
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: { labels: [...new Set([...(conv.labels || []), ...labels])] },
    });
  } catch (err) {
    // Una etiqueta no debe impedir que una reserva ya confirmada llegue al cliente.
    logBot('warn', 'no se pudieron actualizar etiquetas de conversación', { conversationId: conv.id, error: err.message });
  }
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
        interactivePayload: type === 'interactive' ? sendResult.interactivePayload || null : null,
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

function isReceptionRequest(text) {
  const t = normalizeSearchText(text);
  if (!t) return false;
  // Nombres pedidos expresamente por las clientas. Se mantienen variantes
  // frecuentes de escritura para no depender de que la IA esté disponible.
  if (/\b(gianella|gianela|giannella|gianella)\b/.test(t)) return true;
  if (/^(4|humano|humana|asesor|asesora|agente|persona|alguien|recepcion|recepcionista)$/.test(t)) return true;
  const person = '(persona|humano|humana|asesor(?:a)?|agente|recepcion(?:ista)?|alguien|equipo)';
  return new RegExp(`\\b(hablar|comunicar|conectar|pasar|atender|atencion|quiero|quisiera|deseo|necesito|prefiero)\\b[^.!?]{0,80}\\b${person}\\b`).test(t)
    || new RegExp(`\\b${person}\\b[^.!?]{0,80}\\b(por favor|ahora|real|de verdad)\\b`).test(t);
}

function isReceptionOpenNow(tenantConfig = {}, now = new Date()) {
  const tz = getTenantTimezone(tenantConfig);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' })
    .format(now).toLowerCase();
  const weekdayIndex = WEEKDAY_NAME_TO_INDEX[weekday];
  const workDays = Array.isArray(tenantConfig?.workDays)
    ? tenantConfig.workDays.map(Number)
    : [1, 2, 3, 4, 5, 6];
  if (!workDays.includes(weekdayIndex)) return false;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const hour = parts.find((part) => part.type === 'hour')?.value || '00';
  const minute = parts.find((part) => part.type === 'minute')?.value || '00';
  const localTime = `${hour}:${minute}`;
  const hours = normalizeBusinessHours(tenantConfig?.businessHours);
  return [hours.morning, hours.afternoon].some((window) => (
    window && localTime >= window.start && localTime < window.end
  ));
}

function detectDeterministicIntent(text) {
  if (!text) return null;
  const t = String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (/^(hola+|ola+|buenas|buenos dias|buenas tardes|buenas noches|menu|menú|inicio)$/.test(t)) return 'greeting';
  if (isReceptionRequest(t)) return 'escalate';
  if (/^(1|servicio|servicios|catalogo|catalogo de servicios|precios|precio)$/.test(t)) return 'list_services';
  if (hasAnyApproxToken(t, SERVICE_INTENT_WORDS, 2) && hasAnyApproxToken(t, QUESTION_INTENT_WORDS, 1)) return 'list_services';
  if (hasAnyApproxToken(t, RESCHEDULE_WORDS, 2) && /\b(cita|reserva|turno|hora|espacio)\b/.test(t)) return 'reschedule';
  if (/\b(cambiar|mover)\b.*\b(mi|la)\b.*\b(cita|reserva|hora)\b/.test(t)) return 'reschedule';
  if (/^(3|reservar para alguien|reservar para otra persona|agendar para alguien)$/.test(t)) return 'book_for_other';
  if (/^(4|no se que elegir|no sé que elegir|orientame|oriéntame)$/.test(t)) return 'recommend';
  if (/^(5|promociones|promocion|promoción|catalogo alma spa|catálogo alma spa)$/.test(t)) return 'promotions';
  if (/^(6|mi cita|mis citas|consultar cita|ver cita)$/.test(t)) return 'my_appointment';
  if (/^(7|recepcion|recepción|hablar con recepcion|hablar con recepción)$/.test(t)) return 'escalate';
  if (
    hasAnyApproxToken(t, LOCATION_WORDS.filter((word) => word !== 'donde'), 1)
    || /\bdonde\b.*\b(?:queda|quedan|esta|estan|spa|local|ubicad|encuentra)\b/.test(t)
  ) return 'location';
  if (/\b(mi cita|mis citas|cita)\b/.test(t) && (hasAnyApproxToken(t, APPOINTMENT_QUERY_WORDS, 1) || /\bque dia|cuando|a que hora\b/.test(t))) return 'my_appointment';
  if (/^(2|reservar|reserva|agendar|agenda|cita|quiero reservar|quiero agendar)$/.test(t)) return 'book_start';
  if (/\b(quiero|quisiera|deseo|necesito).*\b(reservar|reserva|agendar|agenda|cita)\b/.test(t)) return 'book_start';
  if (/\b(quiero|quisiera|deseo|necesito|hacer|haser)\b/.test(t) && hasAnyApproxToken(t, BOOK_INTENT_WORDS, 2)) return 'book_start';
  if (/\bhacer una reserva\b/.test(t)) return 'book_start';
  if (isExplicitNewBookingRequest(t)) return 'book_start';
  if (hasAnyApproxToken(t, BUSINESS_HOURS_WORDS, 1)) return 'business_hours';
  if (FAREWELL_WORDS.some((phrase) => t === normalizeSearchText(phrase) || t.includes(normalizeSearchText(phrase)))) return 'farewell';
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

function isGenericBookingRequest(text) {
  const t = normalizeSearchText(text);
  return /^(quiero |quisiera |deseo |necesito )?(hacer |agendar |reservar )?(una )?(cita|reserva|reservacion|espacio)$/.test(t);
}

function asksForAvailableAppointments(text) {
  const t = normalizeSearchText(text);
  return /\b(hay|tienen|tengo|quiero ver|mostrar)\b.*\b(citas?|horarios?|espacios?)\b.*\b(disponibles?|libres?|para hoy|para manana)\b/.test(t)
    || /\b(citas?|horarios?|espacios?)\b.*\b(disponibles?|libres?)\b/.test(t);
}

function serviceListPaginationDirection(text) {
  const normalized = normalizeSearchText(text);
  if (/^(ver|mostrar) mas servicios$/.test(normalized)) return 'next';
  if (/^(volver a )?(servicios )?anteriores$/.test(normalized)) return 'previous';
  return null;
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
  return /\b(me duele[n]?|dolor|molestia|tension|tenso|contractura|cansancio|estres|ansiedad)\b/.test(t);
}

function wellnessRecommendationQuery(text) {
  const t = normalizeSearchText(text);
  if (/\b(piernas?|espalda|cuello|hombros?|cuerpo|tension|contractura|estres|cansancio)\b/.test(t)) return 'masaje relajante';
  if (/\b(pies|plantas|talones)\b/.test(t)) return 'reflexologia';
  if (/\b(piel|rostro|cara|facial)\b/.test(t)) return 'limpieza facial';
  return null;
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

async function handleNewClientOnboarding({ tenant, connection, conv, waId, tone, bodyText }) {
  const flowState = state.getFlowState(waId) || {};
  const onboarding = flowState.newClient;

  if (!onboarding) {
    state.setFlowState(waId, { flow: 'new_client', newClient: { step: 'name' }, tone, unclearCount: 0 });
    const prompt = tone === 'tu'
      ? '🌿 *¡Bienvenida a Alma Spa!*\n\nAntes de mostrarte las opciones, ¿me compartes tu nombre completo?'
      : '🌿 *¡Bienvenida a Alma Spa!*\n\nAntes de mostrarle las opciones, ¿me comparte su nombre completo?';
    const r = await transport.sendText(connection, waId, prompt);
    await recordBotMessage(tenant.id, conv, r, { body: prompt });
    return;
  }

  const answer = String(bodyText || '').replace(/\s+/g, ' ').trim();
  if (!answer) return;

  if (onboarding.step === 'name') {
    if (answer.length < 3) {
      const retry = tone === 'tu'
        ? '¿Me compartes tu nombre completo, por favor? 🌿'
        : '¿Me comparte su nombre completo, por favor? 🌿';
      const r = await transport.sendText(connection, waId, retry);
      await recordBotMessage(tenant.id, conv, r, { body: retry });
      return;
    }
    state.setFlowState(waId, { flow: 'new_client', newClient: { step: 'address', fullName: answer }, tone, unclearCount: 0 });
    const prompt = tone === 'tu'
      ? 'Mucho gusto, *' + answer + '* 💛\n\nAhora, ¿me compartes tu dirección?'
      : 'Mucho gusto, *' + answer + '* 💛\n\nAhora, ¿me comparte su dirección?';
    const r = await transport.sendText(connection, waId, prompt);
    await recordBotMessage(tenant.id, conv, r, { body: prompt });
    return;
  }

  if (onboarding.step === 'address') {
    state.setFlowState(waId, {
      flow: 'new_client',
      newClient: { step: 'cedula', fullName: onboarding.fullName, address: answer },
      tone,
      unclearCount: 0,
    });
    const prompt = tone === 'tu'
      ? 'Gracias 💛 Para completar tu ficha, ¿me compartes tu número de cédula? Si prefieres no hacerlo ahora, escribe *Omitir*.'
      : 'Gracias 💛 Para completar su ficha, ¿me comparte su número de cédula? Si prefiere no hacerlo ahora, escriba *Omitir*.';
    const r = await transport.sendText(connection, waId, prompt);
    await recordBotMessage(tenant.id, conv, r, { body: prompt });
    return;
  }

  if (onboarding.step === 'cedula') {
    const omitted = /^(omitir|prefiero no|no deseo|no tengo)$/i.test(answer);
    const cedula = omitted ? null : answer.replace(/\s+/g, ' ').trim();
    if (!omitted && (cedula.length < 6 || cedula.length > 32)) {
      const retry = tone === 'tu'
        ? '¿Puedes revisar el número de cédula? También puedes escribir *Omitir* para continuar. 🌿'
        : '¿Puede revisar el número de cédula? También puede escribir *Omitir* para continuar. 🌿';
      const r = await transport.sendText(connection, waId, retry);
      await recordBotMessage(tenant.id, conv, r, { body: retry });
      return;
    }
    let client;
    try {
      client = await prisma.client.create({
        data: {
          tenantId: tenant.id,
          fullName: onboarding.fullName,
          whatsapp: waIdToPhone(waId),
          address: onboarding.address,
          cedula,
        },
      });
    } catch (err) {
      if (err?.code !== 'P2002') throw err;
      client = await lookupClientByWaId(tenant.id, waId);
      if (!client) throw err;
    }

    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: {
        clientId: client.id,
        customerName: client.fullName,
        labels: [...new Set([...(conv.labels || []), 'nueva_clienta'])],
      },
    });
    state.setFlowState(waId, { flow: 'menu', newClient: null, clientName: client.fullName, tone, unclearCount: 0 });
    const welcome = tone === 'tu'
      ? '✨ *¡Listo, ' + client.fullName + '!* Ya registré tus datos. ¿Qué te gustaría hacer?'
      : '✨ *¡Listo, ' + client.fullName + '!* Ya registré sus datos. ¿Qué le gustaría hacer?';
    const r = await transport.sendText(connection, waId, welcome);
    await recordBotMessage(tenant.id, conv, r, { body: welcome });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }
}

function extractPhoneFromRecipientText(text) {
  const raw = String(text || '');
  const candidates = raw.match(/(?:\+?\d[\d\s().-]{6,}\d)/g) || [];
  for (const candidate of candidates) {
    const phone = normalizePhone(candidate);
    if (isValidE164(phone)) return phone;
  }
  const fallback = normalizePhone(raw);
  return isValidE164(fallback) ? fallback : '';
}

function extractRecipientName(text) {
  const withoutPhone = String(text || '').replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, ' ');
  const marker = /\b(?:mi\s+nombre(?:\s+completo)?|nombre(?:\s+completo)?|soy|me\s+llamo|se\s+llama|la\s+persona\s+(?:se\s+llama|es)|para\s+quien\s+(?:es|quiero)|es\s+para)\s*(?:es)?\s+(.+)/i.exec(withoutPhone);
  let candidate = marker?.[1] || withoutPhone;
  candidate = candidate
    .replace(/^.*?\bpara\s+/i, '')
    .replace(/(?:\s*(?:,|y)?\s*(?:el|su|mi)?\s*(?:n[uú]mero(?:\s+(?:de\s+)?(?:tel[eé]fono|whatsapp))?|tel[eé]fono|celular|whatsapp)\s*(?:es)?\s*.*)$/i, '')
    .replace(/^\s*(?:mi\s+amiga|mi\s+mam[aá]|mi\s+pap[aá]|mi\s+hermana|mi\s+hermano|la\s+persona)\s+/i, '')
    .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = candidate.split(/\s+/).filter(Boolean);
  const reserved = new Set(['quiero', 'reservar', 'reserva', 'agendar', 'cita', 'para', 'favor', 'gracias', 'hola']);
  if (candidate.length < 2 || candidate.length > 100 || words.length > 6 || words.some((word) => reserved.has(word.toLowerCase()))) {
    return '';
  }
  return candidate;
}

async function handleBookForOther({ tenant, connection, conv, waId, tone, bodyText = null }) {
  const fs = state.getFlowState(waId) || {};
  const bookingForOther = fs.bookingForOther;

  if (!bookingForOther) {
    state.setFlowState(waId, { flow: 'booking_for_other', bookingForOther: { step: 'name' }, clientName: fs.clientName, tone, unclearCount: 0 });
    const msg = tone === 'tu'
      ? '👤 Claro. ¿Cómo se llama la persona para quien quieres reservar? Si prefieres, envíame su nombre y número juntos, por ejemplo: *Sofía Andrade, 099 876 5432*.'
      : '👤 Claro. ¿Cómo se llama la persona para quien desea reservar? Si prefiere, envíeme su nombre y número juntos, por ejemplo: *Sofía Andrade, 099 876 5432*.';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return;
  }

  const answer = String(bodyText || '').replace(/\s+/g, ' ').trim();
  if (!answer) return;

  if (bookingForOther.step === 'phone') {
    const phone = extractPhoneFromRecipientText(answer);
    if (!isValidE164(phone)) {
      const msg = tone === 'tu'
        ? '💛 Escríbeme un número válido, por ejemplo: *099 876 5432*.'
        : '💛 Escríbame un número válido, por ejemplo: *099 876 5432*.';
      const r = await transport.sendText(connection, waId, msg);
      await recordBotMessage(tenant.id, conv, r, { body: msg });
      return;
    }
    const existing = await prisma.client.findFirst({ where: { tenantId: tenant.id, whatsapp: phone } });
    if (existing) {
      if (bookingForOther.continuation === 'same_day_booking' && fs.booking?.date) {
        const booking = fs.booking;
        state.setFlowState(waId, {
          flow: 'booking',
          bookingForOther: null,
          booking: {
            ...booking,
            step: 'select_date',
            clientId: existing.id,
            clientName: existing.fullName,
            clientPhone: phone,
            forOther: true,
          },
          clientName: fs.clientName,
          tone,
          unclearCount: 0,
        });
        const msg = `👤 *${existing.fullName}* ya está registrado. Veamos sus horarios disponibles.`;
        const r = await transport.sendText(connection, waId, msg);
        await recordBotMessage(tenant.id, conv, r, { body: msg });
        return handleBookingDateSelected({ tenant, connection, conv, waId, tone, date: booking.date });
      }
      state.setFlowState(waId, {
        flow: 'booking',
        bookingForOther: null,
        booking: { step: 'select_service', clientId: existing.id, clientName: existing.fullName, clientPhone: phone, forOther: true },
        clientName: fs.clientName,
        tone,
        unclearCount: 0,
      });
      const msg = tone === 'tu'
        ? '👤 *' + existing.fullName + '* ya está registrado. Ahora elige el servicio para su cita:'
        : '👤 *' + existing.fullName + '* ya está registrado. Ahora elija el servicio para su cita:';
      const r = await transport.sendText(connection, waId, msg);
      await recordBotMessage(tenant.id, conv, r, { body: msg });
      return handleBook({ tenant, connection, conv, waId, tone });
    }

    const fullName = bookingForOther.fullName || extractRecipientName(answer);
    if (fullName) {
      state.setFlowState(waId, { ...fs, flow: 'booking_for_other', bookingForOther: { ...bookingForOther, step: 'address', phone, fullName }, clientName: fs.clientName, tone, unclearCount: 0 });
      const msg = tone === 'tu' ? '📍 Perfecto. ¿Me compartes su dirección?' : '📍 Perfecto. ¿Me comparte su dirección?';
      const r = await transport.sendText(connection, waId, msg);
      await recordBotMessage(tenant.id, conv, r, { body: msg });
      return;
    }

    state.setFlowState(waId, { ...fs, flow: 'booking_for_other', bookingForOther: { ...bookingForOther, step: 'name', phone }, clientName: fs.clientName, tone, unclearCount: 0 });
    const msg = '💛 Perfecto. ¿Cuál es su nombre completo?';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return;
  }

  if (bookingForOther.step === 'name') {
    const fullName = extractRecipientName(answer);
    if (!fullName) {
      const msg = tone === 'tu' ? '💛 Escríbeme su nombre completo, por favor.' : '💛 Por favor, escriba su nombre completo.';
      const r = await transport.sendText(connection, waId, msg);
      await recordBotMessage(tenant.id, conv, r, { body: msg });
      return;
    }
    const phone = extractPhoneFromRecipientText(answer);
    state.setFlowState(waId, { ...fs, flow: 'booking_for_other', bookingForOther: { ...bookingForOther, step: 'phone', fullName }, clientName: fs.clientName, tone, unclearCount: 0 });
    if (isValidE164(phone)) {
      // La persona puede enviar nombre y número en cualquier orden.
      // Reutilizamos la misma validación y búsqueda de ficha que en el paso
      // de teléfono, sin pedirle que repita ningún dato.
      return handleBookForOther({ tenant, connection, conv, waId, tone, bodyText: phone });
    }
    const msg = '📱 Gracias. ¿Cuál es su número de WhatsApp?';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return;
  }

  if (bookingForOther.step === 'address') {
    if (answer.length < 5 || answer.length > 200) {
      const msg = tone === 'tu' ? '📍 Compárteme una dirección un poco más completa, por favor.' : '📍 Por favor, comparta una dirección más completa.';
      const r = await transport.sendText(connection, waId, msg);
      await recordBotMessage(tenant.id, conv, r, { body: msg });
      return;
    }
    let client;
    try {
      client = await prisma.client.create({
        data: { tenantId: tenant.id, fullName: bookingForOther.fullName, whatsapp: bookingForOther.phone, address: answer },
      });
    } catch (err) {
      if (err?.code !== 'P2002') throw err;
      client = await prisma.client.findFirst({ where: { tenantId: tenant.id, whatsapp: bookingForOther.phone } });
      if (!client) throw err;
    }
    if (bookingForOther.continuation === 'same_day_booking' && fs.booking?.date) {
      const booking = fs.booking;
      state.setFlowState(waId, {
        flow: 'booking',
        bookingForOther: null,
        booking: {
          ...booking,
          step: 'select_date',
          clientId: client.id,
          clientName: client.fullName,
          clientPhone: bookingForOther.phone,
          forOther: true,
        },
        clientName: fs.clientName,
        tone,
        unclearCount: 0,
      });
      const msg = `✨ *Listo, ${client.fullName} ya está registrado.* Veamos sus horarios disponibles.`;
      const r = await transport.sendText(connection, waId, msg);
      await recordBotMessage(tenant.id, conv, r, { body: msg });
      return handleBookingDateSelected({ tenant, connection, conv, waId, tone, date: booking.date });
    }
    state.setFlowState(waId, {
      flow: 'booking',
      bookingForOther: null,
      booking: { step: 'select_service', clientId: client.id, clientName: client.fullName, clientPhone: bookingForOther.phone, forOther: true },
      clientName: fs.clientName,
      tone,
      unclearCount: 0,
    });
    const msg = tone === 'tu'
      ? '✨ *Listo, ' + client.fullName + ' ya está registrado.* Ahora elige el servicio para su cita:'
      : '✨ *Listo, ' + client.fullName + ' ya está registrado.* Ahora elija el servicio para su cita:';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return handleBook({ tenant, connection, conv, waId, tone });
  }
}

async function loadServicesForAI(tenantId) {
  const services = await loadVisibleServicesForBot(tenantId);
  return services.map((service) => ({
    ...service,
    description: serviceCatalogDescription(service),
  }));
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

  // Normalmente las listas interactivas incluyen un id. Como respaldo, usamos
  // también el título visible: algunos reenvíos/proveedores lo conservan aunque
  // omitan ese id (por ejemplo, "Ver más servicios").
  const bodyText = incoming.type === 'text'
    ? incoming.text?.body ?? null
    : incoming.type === 'interactive'
      ? incoming.interactive?.list_reply?.title
        || incoming.interactive?.button_reply?.title
        || null
      : null;
  const priorState = state.getFlowState(waId) || {};
  const tone = detectTone(bodyText) || priorState.tone || 'tu';

  // Aunque una conversación antigua todavía no esté enlazada a la ficha del
  // contacto, no puede interrumpir el alta de la persona para quien se está
  // reservando. Este flujo se reanuda antes del onboarding del remitente.
  if (priorState.bookingForOther && bodyText) {
    return handleBookForOther({ tenant, connection, conv, waId, tone, bodyText });
  }

  // Una conversación antigua puede no estar enlazada aunque la clienta ya
  // exista. Solo iniciamos el alta cuando el número no existe realmente.
  let clientId = conv.clientId;
  if (!clientId) {
    const existingClient = await lookupClientByWaId(tenant.id, waId);
    if (existingClient) {
      clientId = existingClient.id;
      await prisma.whatsAppConversation.update({ where: { id: conv.id }, data: { clientId } });
    }
  }
  if (!clientId) {
    return handleNewClientOnboarding({ tenant, connection, conv, waId, tone, bodyText });
  }

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
  if (flowState.bookingForOther) {
    return handleBookForOther({ tenant, connection, conv, waId, tone, bodyText });
  }

  // Meta normalmente entrega el id de una lista interactiva. Si un cliente o
  // un reenvío sólo conserva el título visible, mantenemos la paginación del
  // catálogo en lugar de responder como si fuera una consulta libre.
  const paginationDirection = serviceListPaginationDirection(bodyText);
  if (paginationDirection) {
    const currentPage = Number(flowState.servicesPage) || 0;
    const page = paginationDirection === 'next'
      ? currentPage + 1
      : Math.max(currentPage - 1, 0);
    return handleListServices({ tenant, connection, conv, waId, tone, page });
  }

  if (asksForAvailableAppointments(bodyText)) {
    const intro = tone === 'tu'
      ? '📅 Para mostrarte horarios realmente disponibles, primero elige el servicio.'
      : '📅 Para mostrarle horarios realmente disponibles, primero elija el servicio.';
    return handleBook({ tenant, connection, conv, waId, tone, aiReply: intro });
  }

  if (describesWellnessNeed(bodyText) && !hasExplicitBookingLanguage(bodyText)) {
    const query = wellnessRecommendationQuery(bodyText);
    if (query) {
      const recommended = await matchServiceByQuery(tenant.id, query);
      if (recommended) return handleServiceDetail({ tenant, connection, conv, waId, tone, serviceId: recommended.id });
    }
  }

  const priorityIntent = detectDeterministicIntent(bodyText);
  // Un mensaje libre de reserva puede traer servicio, fecha y hora. Si la IA
  // está disponible, debe extraer esos datos para llevar la clienta directo a
  // la disponibilidad real, en vez de devolverla al selector inicial.
  const letAIResolveBooking = priorityIntent === 'book_start'
    && !isGenericBookingRequest(bodyText)
    && aiClient.isAvailable();

  // La petición nueva y explícita de la clienta manda sobre cualquier flujo previo.
  if (priorityIntent === 'book_start' && !letAIResolveBooking) {
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
      return sendMainMenu({ tenant, connection, conv, waId, tone, compact: true });
    }
  }

  if (flowState.booking && flowState.booking.step !== 'ask_name') {
    const requestedService = await matchServiceByQuery(tenant.id, bodyText);
    if (requestedService && isExplicitServiceChoice(bodyText, requestedService)) {
      return handleBookingServiceSelected({ tenant, connection, conv, waId, tone, serviceId: requestedService.id });
    }
  }

  const deterministicIntent = letAIResolveBooking ? null : priorityIntent;
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

    case 'book_for_other':
      return handleBookForOther({ tenant, connection, conv, waId, tone });

    case 'recommend':
      return handleServiceRecommendation({ tenant, connection, conv, waId, tone });

    case 'promotions':
      return handlePromotions({ tenant, connection, conv, waId, tone });

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

    case 'location':
      return handleLocation({ tenant, connection, conv, waId });

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
  const isGenericCatalogDescription = /^servicio de .+ con duraci[oó]n aproximada/i.test(description)
    || /^a[uú]n no tengo una descripci[oó]n detallada/i.test(description);
  if (description && !isGenericCatalogDescription) return description.slice(0, 300);
  return serviceInfoFallback(service);
}

function serviceInfoFallback(service) {
  const name = normalizeSearchText(service?.name);
  if (name.includes('camilla ceragem')) return 'Sesión de bienestar en camilla de masaje mecánico, pensada para una pausa de comodidad y relajación corporal.';
  if (name.includes('corporal') || name.includes('reductor')) return 'Tratamiento corporal estético orientado al cuidado de la piel y la silueta. Los resultados dependen de cada persona y del protocolo profesional.';
  if (name.includes('depil')) return 'Sesión de depilación con tecnología láser para una reducción progresiva del vello; requiere valoración según piel, vello y antecedentes.';
  if (name.includes('detox')) return 'Baño de pies de bienestar para una pausa de relajación. No sustituye atención médica ni elimina toxinas del organismo.';
  if (name.includes('drenaje post')) return 'Acompañamiento de bienestar posterior a un procedimiento, únicamente con autorización del cirujano y valoración profesional; no reemplaza el seguimiento médico.';
  if (name.includes('emo vacuna')) return 'Sesión de bienestar con orientación previa de recepción para explicarle el protocolo y confirmar si es adecuada para usted.';
  if (name.includes('masaje')) return 'Masaje de bienestar orientado a la relajación y al descanso. No sustituye una valoración médica ante dolor intenso, nuevo o persistente.';
  if (name.includes('reflex')) return 'Práctica complementaria de presión y masaje en los pies, pensada para relajación. No trata ni cura enfermedades.';
  if (name.includes('sueroterapia')) return 'Atención clínica que requiere valoración y administración por un profesional de salud habilitado. Recepción coordina la orientación previa.';
  if (name.includes('terapia neural')) return 'Atención clínica que requiere valoración y aplicación exclusivamente por un profesional de salud habilitado. Recepción coordina la orientación previa.';
  if (name.includes('energet')) return 'Práctica complementaria de bienestar enfocada en relajación y presencia. No sustituye atención médica ni trata enfermedades.';
  if (name.includes('facial')) return 'Cuidado estético facial para limpiar, renovar e hidratar la piel, adaptado a sus necesidades tras una valoración profesional.';
  if (name.includes('yoga')) return 'Práctica guiada de movimiento y bienestar. La profesional adapta la sesión a su experiencia y condición física.';
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

async function handleServiceRecommendation({ tenant, connection, conv, waId, tone }) {
  const previous = state.getFlowState(waId) || {};
  state.setFlowState(waId, { ...previous, flow: 'recommend_service', tone, unclearCount: 0 });
  const msg = tone === 'tu'
    ? '✨ Cuéntame qué te gustaría mejorar o cómo quieres sentirte. Te orientaré con opciones de bienestar y, si lo prefieres, podemos agendar una *valoración personalizada en Alma Spa* para recomendarte el servicio más adecuado. Si hay dolor fuerte, reciente o persistente, es mejor consultar a un profesional de salud.'
    : '✨ Cuénteme qué le gustaría mejorar o cómo quiere sentirse. Le orientaré con opciones de bienestar y, si lo prefiere, podemos agendar una *valoración personalizada en Alma Spa* para recomendarle el servicio más adecuado. Si hay dolor fuerte, reciente o persistente, es mejor consultar a un profesional de salud.';
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
}

async function handlePromotions({ tenant, connection, conv, waId, tone }) {
  const msg = tone === 'tu'
    ? '🌸 *Promociones y catálogo Alma Spa*\n\nDescubre nuestras promociones, novedades y bienestar en Instagram:\nhttps://www.instagram.com/alma_spaholistica/\n\n📖 *Catálogo de servicios*\nhttps://drive.google.com/file/d/12_6QAi4ZwMlLElp0QgbrGh5WmZF4WWRE/view\n\n🔗 También puedes ver todos nuestros enlaces aquí:\nhttps://linktr.ee/almaspa_02'
    : '🌸 *Promociones y catálogo Alma Spa*\n\nDescubra nuestras promociones, novedades y bienestar en Instagram:\nhttps://www.instagram.com/alma_spaholistica/\n\n📖 *Catálogo de servicios*\nhttps://drive.google.com/file/d/12_6QAi4ZwMlLElp0QgbrGh5WmZF4WWRE/view\n\n🔗 También puede ver todos nuestros enlaces aquí:\nhttps://linktr.ee/almaspa_02';
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
  return sendMainMenu({ tenant, connection, conv, waId, tone, compact: true });
}

async function sendMainMenu({ tenant, connection, conv, waId, tone, compact = false }) {
  const prev = state.getFlowState(waId) || {};
  const stateOrConversationName = prev.clientName || conv.customerName || null;
  const knownClient = stateOrConversationName
    ? null
    : await lookupClientByWaId(tenant.id, waId);
  const clientName = stateOrConversationName || knownClient?.fullName || null;
  state.setFlowState(waId, { flow: 'menu', tone, unclearCount: 0, clientName });
  const payload = menus.mainMenu({ tone, clientName, compact });
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

  const fallback = menus.mainMenuText({ tone, clientName, compact });
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
  if (selectionId === menus.BOOK_RECIPIENT_SELF) {
    const fs = state.getFlowState(waId) || {};
    if (!fs.booking?.date) return handleBook({ tenant, connection, conv, waId, tone });
    state.setFlowState(waId, {
      ...fs,
      flow: 'booking',
      booking: { ...fs.booking, recipientChoice: 'self' },
      tone,
      unclearCount: 0,
    });
    return handleBookingDateSelected({ tenant, connection, conv, waId, tone, date: fs.booking.date });
  }
  if (selectionId === menus.BOOK_RECIPIENT_OTHER) {
    const fs = state.getFlowState(waId) || {};
    if (!fs.booking?.date) return handleBook({ tenant, connection, conv, waId, tone });
    state.setFlowState(waId, {
      flow: 'booking_for_other',
      booking: { ...fs.booking, recipientChoice: 'other' },
      bookingForOther: { step: 'name', continuation: 'same_day_booking' },
      clientName: fs.clientName,
      tone,
      unclearCount: 0,
    });
    const msg = tone === 'tu'
      ? '👤 Perfecto. ¿Cómo se llama la persona para quien quieres reservar? Puedes enviarme también su número en el mismo mensaje.'
      : '👤 Perfecto. ¿Cómo se llama la persona para quien desea reservar? Puede enviarme también su número en el mismo mensaje.';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return;
  }
  if (selectionId.startsWith(menus.BOOK_DATE_PREFIX)) {
    const date = selectionId.slice(menus.BOOK_DATE_PREFIX.length);
    const flowState = state.getFlowState(waId);
    if (flowState?.reschedule?.appointmentId) {
      return handleRescheduleDateSelected({ tenant, connection, conv, waId, tone, date });
    }
    return handleBookingDateSelected({ tenant, connection, conv, waId, tone, date });
  }
  if (selectionId.startsWith(menus.BOOK_TIME_PREFIX) && !selectionId.startsWith(menus.BOOK_TIME_PAGE_PREFIX)) {
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
    return sendMainMenu({ tenant, connection, conv, waId, tone, compact: true });
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
    return sendMainMenu({ tenant, connection, conv, waId, tone, compact: true });
  }
  if (selectionId.startsWith(menus.RESCHEDULE_APPOINTMENT_PREFIX)) {
    const appointmentId = selectionId.slice(menus.RESCHEDULE_APPOINTMENT_PREFIX.length);
    return handleReschedule({ tenant, connection, conv, waId, tone, appointmentId });
  }

  if (selectionId.startsWith(menus.BOOK_TIME_PAGE_PREFIX)) {
    const page = Number.parseInt(selectionId.slice(menus.BOOK_TIME_PAGE_PREFIX.length), 10);
    const fs = state.getFlowState(waId) || {};
    if (fs?.reschedule?.availableSlots) {
      return showRescheduleTimeSlots({ tenant, connection, conv, waId, tone, page: Number.isFinite(page) ? page : 0 });
    }
    return showBookingTimeSlots({ tenant, connection, conv, waId, tone, page: Number.isFinite(page) ? page : 0 });
  }

  if (selectionId === menus.BOOK_PERIOD_MORNING || selectionId === menus.BOOK_PERIOD_AFTERNOON) {
    const period = selectionId === menus.BOOK_PERIOD_MORNING ? 'morning' : 'afternoon';
    const fs = state.getFlowState(waId) || {};
    if (fs?.reschedule?.appointmentId) {
      return handleReschedulePeriodSelected({ tenant, connection, conv, waId, tone, period });
    }
    return handleBookingPeriodSelected({ tenant, connection, conv, waId, tone, period });
  }

  if (selectionId.startsWith(menus.SERVICE_PAGE_PREFIX)) {
    const page = Number.parseInt(selectionId.slice(menus.SERVICE_PAGE_PREFIX.length), 10);
    const fs = state.getFlowState(waId) || {};
    if (fs?.booking?.step === 'select_service') {
      return handleBook({ tenant, connection, conv, waId, tone, page: Number.isFinite(page) ? page : 0 });
    }
    return handleListServices({ tenant, connection, conv, waId, tone, page: Number.isFinite(page) ? page : 0 });
  }

  if (selectionId.startsWith(menus.BOOK_SERVICE_PREFIX)) {
    const serviceId = selectionId.slice(menus.BOOK_SERVICE_PREFIX.length);
    return handleBookingServiceSelected({ tenant, connection, conv, waId, tone, serviceId });
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

  if (selectionId === menus.MAIN_MENU_BACK) {
    const fs = state.getFlowState(waId) || {};
    // El menú principal no debe heredar una reserva o reprogramación a medias.
    state.setFlowState(waId, {
      flow: 'menu',
      booking: null,
      reschedule: null,
      bookingForOther: null,
      clientName: fs.clientName,
      tone,
      unclearCount: 0,
    });
    return sendMainMenu({ tenant, connection, conv, waId, tone, compact: true });
  }

  if (selectionId === menus.NAV_BACK_MENU) {
    const fs = state.getFlowState(waId) || {};
    if (fs?.booking?.step === 'select_time' || fs?.booking?.step === 'select_period') {
      return showBookingDatePicker({ tenant, connection, conv, waId, tone });
    }
    if (fs?.reschedule?.step === 'select_time' || fs?.reschedule?.step === 'select_period') {
      return handleReschedule({ tenant, connection, conv, waId, tone });
    }
    if (fs?.booking) return handleBook({ tenant, connection, conv, waId, tone });
    if (fs?.reschedule) return handleMyAppointment({ tenant, connection, conv, waId, tone });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  // Non-booking selections — safe to reset state
  state.setFlowState(waId, { flow: 'selection', tone, unclearCount: 0 });

  if (selectionId === menus.MAIN_MENU_IDS.LIST_SERVICES) {
    return handleListServices({ tenant, connection, conv, waId, tone });
  }
  if (selectionId === menus.MAIN_MENU_IDS.BOOK) {
    return handleBook({ tenant, connection, conv, waId, tone });
  }
  if (selectionId === menus.MAIN_MENU_IDS.BOOK_FOR_OTHER) {
    return handleBookForOther({ tenant, connection, conv, waId, tone });
  }
  if (selectionId === menus.MAIN_MENU_IDS.RECOMMEND) {
    return handleServiceRecommendation({ tenant, connection, conv, waId, tone });
  }
  if (selectionId === menus.MAIN_MENU_IDS.PROMOTIONS) {
    return handlePromotions({ tenant, connection, conv, waId, tone });
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

async function handleListServices({ tenant, connection, conv, waId, tone, asText = false, page = 0 }) {
  const svcs = await loadVisibleServicesForBot(tenant.id);
  state.setFlowState(waId, { flow: 'listing_services', servicesPage: Math.max(0, Number(page) || 0), tone, unclearCount: 0 });

  const visible = svcs;
  if (asText) {
    const text = buildServicesCatalogText(visible, { tone });
    await sendTextChunks({ tenant, connection, conv, waId, text });
    return;
  }

  const payload = menus.servicesList(visible, { tone, page });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[servicios página ${Number(page) + 1}]` });
}

async function handleCategoryServices({ tenant, connection, conv, waId, tone, categoryName }) {
  const svcs = await loadVisibleServicesForBot(tenant.id, { category: categoryName });
  if (svcs.length === 0) {
    const msg = tone === 'tu'
      ? '🤔 *No encontré servicios ahí* — te muestro las opciones:'
      : '🤔 *No encontré servicios ahí* — le muestro las opciones:';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone, compact: true });
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
  const icon = menus.serviceEmoji(svc);
  const caption = `${icon} *_${svc.name}_*\n💰 $${Number(svc.priceUsd).toFixed(2)} · ${svc.durationMins || 60} min${descLine}`;

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

  const actions = menus.serviceDetailActions(svc, { tone });
  const r2 = await transport.sendInteractive(connection, waId, actions);
  await recordBotMessage(tenant.id, conv, r2, { type: 'interactive', body: `[acciones de ${svc.name}]` });
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

async function handleBook({ tenant, connection, conv, waId, tone, aiReply, page = 0 }) {
  const visible = await loadVisibleServicesForBot(tenant.id);
  if (visible.length === 0) {
    const msg = tone === 'tu'
      ? '😅 *Aún no tenemos servicios disponibles*\n\nComunícate con recepción 💛'
      : '😅 *Aún no tenemos servicios disponibles*\n\nComuníquese con recepción 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({
      tenant,
      connection,
      conv,
      waId,
      tone,
      compact: true,
    });
  }

  const prev = state.getFlowState(waId) || {};
  const bookingClient = prev.booking?.forOther
    ? {
      clientId: prev.booking.clientId,
      clientName: prev.booking.clientName,
      clientPhone: prev.booking.clientPhone,
      forOther: true,
    }
    : {};
  state.setFlowState(waId, {
    flow: 'booking',
    booking: { step: 'select_service', ...bookingClient },
    clientName: prev.clientName,
    tone,
    unclearCount: 0,
  });

  const intro = aiReply || (tone === 'tu'
    ? '✨ *¡Qué lindo que quieres darte un momento!*\n\nElige tu servicio:'
    : '✨ *¡Qué lindo que desea darse un momento!*\n\nElija su servicio:');

  const payload = menus.servicesList(visible, { tone, body: intro, page });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: '[selección de servicio para reserva]' });
}

async function handleSmartBooking({ tenant, connection, conv, waId, tone, service, date, time, aiReply }) {
  const tenantData = await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { config: true } });
  const bookingClient = await lookupClientByWaId(tenant.id, waId);
  let slots;
  try {
    slots = await appointmentService.getAvailability({
      tenantId: tenant.id,
      tenantConfig: tenantData?.config,
      serviceId: service.id,
      date,
      modality: 'spa',
      clientId: bookingClient?.id || null,
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

  if (time) {
    state.setFlowState(waId, {
      flow: 'booking',
      booking: { step: 'select_time', serviceId: service.id, serviceName: service.name, date, allAvailableSlots: slots, availableSlots: slots },
      clientName: prev.clientName,
      tone,
      unclearCount: 0,
    });
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
    state.setFlowState(waId, {
      flow: 'booking',
      booking: { step: 'select_period', serviceId: service.id, serviceName: service.name, date, allAvailableSlots: slots, availableSlots: slots },
      clientName: prev.clientName,
      tone,
      unclearCount: 0,
    });
    return showBookingPeriodPicker({ tenant, connection, conv, waId, tone, body });
  }

  state.setFlowState(waId, {
    flow: 'booking',
    booking: { step: 'select_period', serviceId: service.id, serviceName: service.name, date, allAvailableSlots: slots, availableSlots: slots },
    clientName: prev.clientName,
    tone,
    unclearCount: 0,
  });
  return showBookingPeriodPicker({ tenant, connection, conv, waId, tone });
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
    booking: {
      step: 'select_date',
      serviceId: svc.id,
      serviceName: svc.name,
      clientId: prev.booking?.clientId,
      clientName: prev.booking?.clientName,
      clientPhone: prev.booking?.clientPhone,
      forOther: Boolean(prev.booking?.forOther),
    },
    clientName: prev.clientName,
    tone,
    unclearCount: 0,
  });

  const description = serviceCatalogDescription(svc);
  const body = tone === 'tu'
    ? '✨ *_' + svc.name + '_ — excelente elección*\n\n' + description + '\n\n¿Qué día te queda bien?'
    : '✨ *_' + svc.name + '_ — excelente elección*\n\n' + description + '\n\n¿Qué día le queda bien?';
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
  const bookingClient = fs.booking.clientId
    ? { id: fs.booking.clientId }
    : await lookupClientByWaId(tenant.id, waId);

  // Antes de proponer horarios del mismo día, aclaramos para quién es la
  // nueva reserva. Así no se intenta acomodar dos tratamientos simultáneos
  // para la misma persona y el cliente puede continuar para un acompañante.
  if (bookingClient?.id && !fs.booking.forOther && !fs.booking.recipientChoice) {
    const dayStart = new Date(`${date}T00:00:00-05:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const sameDayAppointment = await prisma.appointment.findFirst({
      where: {
        tenantId: tenant.id,
        clientId: bookingClient.id,
        status: { in: ['pendiente', 'pendiente_bot', 'confirmado'] },
        startsAt: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true },
    });
    if (sameDayAppointment) {
      state.setFlowState(waId, {
        ...fs,
        flow: 'booking',
        booking: { ...fs.booking, step: 'select_recipient', date },
        tone,
        unclearCount: 0,
      });
      const payload = menus.bookingRecipientPicker({ tone });
      const r = await transport.sendInteractive(connection, waId, payload);
      await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: '[reserva: misma fecha, elegir persona]' });
      return;
    }
  }

  let slots;
  try {
    slots = await appointmentService.getAvailability({
      tenantId: tenant.id,
      tenantConfig: tenantData?.config,
      serviceId: fs.booking.serviceId,
      date,
      modality: 'spa',
      clientId: bookingClient?.id || null,
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
    booking: { ...fs.booking, step: 'select_period', date, allAvailableSlots: slots, availableSlots: slots },
    clientName: fs.clientName,
    tone,
    unclearCount: 0,
  });

  if (requestedTime) {
    const slotIndex = findSlotIndexByTime(slots, requestedTime);
    if (slotIndex >= 0) return handleBookingTimeSelected({ tenant, connection, conv, waId, tone, slotIndex });
  }
  return showBookingPeriodPicker({
    tenant, connection, conv, waId, tone,
    body: requestedTime ? `😅 *No hay horario a las ${requestedTime}*\n\nVeamos otro momento del día:` : undefined,
  });
}

function slotsForPeriod(slots, period) {
  return (slots || []).filter((slot) => {
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone: menus.SPA_TZ, hour: 'numeric', hour12: false,
    }).formatToParts(new Date(slot)).find((part) => part.type === 'hour')?.value;
    const numericHour = Number(hour || 0);
    return period === 'morning' ? numericHour < 13 : numericHour >= 13;
  });
}

async function showBookingDatePicker({ tenant, connection, conv, waId, tone }) {
  const fs = state.getFlowState(waId) || {};
  const body = tone === 'tu'
    ? `📅 ¿Qué otro día te queda bien para _${fs.booking?.serviceName || 'tu servicio'}_?`
    : `📅 ¿Qué otro día le queda bien para _${fs.booking?.serviceName || 'su servicio'}_?`;
  const payload = menus.datePicker({ tone, body });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: '[volver a elegir fecha]' });
}

async function showBookingPeriodPicker({ tenant, connection, conv, waId, tone, body }) {
  const fs = state.getFlowState(waId) || {};
  const booking = fs.booking || {};
  const slots = booking.allAvailableSlots || booking.availableSlots || [];
  const hasMorning = slotsForPeriod(slots, 'morning').length > 0;
  const hasAfternoon = slotsForPeriod(slots, 'afternoon').length > 0;

  if (hasMorning && hasAfternoon) {
    const payload = menus.timePeriodPicker({ tone });
    if (body) payload.body = { text: body };
    const r = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: '[elegir mañana o tarde]' });
    return;
  }

  return handleBookingPeriodSelected({
    tenant, connection, conv, waId, tone,
    period: hasMorning ? 'morning' : 'afternoon', body,
  });
}

async function handleBookingPeriodSelected({ tenant, connection, conv, waId, tone, period, body }) {
  const fs = state.getFlowState(waId) || {};
  const booking = fs.booking;
  if (!booking?.serviceId) return handleBook({ tenant, connection, conv, waId, tone });
  const availableSlots = slotsForPeriod(booking.allAvailableSlots || booking.availableSlots, period);
  if (!availableSlots.length) return showBookingPeriodPicker({ tenant, connection, conv, waId, tone });
  state.setFlowState(waId, {
    ...fs,
    flow: 'booking',
    booking: { ...booking, step: 'select_time', period, availableSlots },
    tone,
    unclearCount: 0,
  });
  return showBookingTimeSlots({ tenant, connection, conv, waId, tone, body });
}

async function showBookingTimeSlots({ tenant, connection, conv, waId, tone, page = 0, body }) {
  const fs = state.getFlowState(waId) || {};
  const booking = fs.booking;
  if (!booking?.serviceId || !booking?.availableSlots?.length) {
    return handleBook({ tenant, connection, conv, waId, tone });
  }
  const periodLabel = booking.period === 'morning' ? '🌅 Mañana' : '🌆 Tarde';
  const payload = menus.timeSlotList(booking.availableSlots, booking.serviceName, {
    tone,
    page,
    body: body || `${periodLabel} · *Horarios para* _${booking.serviceName}_`,
  });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[horarios ${booking.period || 'disponibles'} página ${Number(page) + 1}]` });
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

  const client = fs.booking.clientId ? null : await lookupClientByWaId(tenant.id, waId);
  const clientName = fs.booking.clientName || client?.fullName || fs.clientName;

  state.setFlowState(waId, {
    flow: 'booking',
    booking: { ...fs.booking, step: clientName ? 'confirm' : 'ask_name', timeSlot: slot, clientName },
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

  try {
    let appointment;
    await prisma.$transaction(async (tx) => {
      const client = booking.clientId
        ? { id: booking.clientId }
        : await clientService.upsertClient(tx, tenant.id, {
          fullName: booking.clientName,
          whatsapp: waIdToPhone(waId),
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
    await appendConversationLabels(conv, ['cita_confirmada']);

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

async function upcomingAppointmentsForClient(tenantId, clientId, { includeRoom = false } = {}) {
  const query = {
    where: {
      tenantId,
      clientId,
      status: { in: ['pendiente', 'pendiente_bot', 'confirmado'] },
      startsAt: { gte: new Date() },
    },
    orderBy: { startsAt: 'asc' },
    include: includeRoom ? { service: true, room: true } : { service: true },
  };
  // El fallback conserva compatibilidad con adaptadores antiguos; en Prisma
  // real siempre se usa findMany para que el cliente vea todas sus citas.
  if (typeof prisma.appointment.findMany === 'function') {
    return prisma.appointment.findMany(query);
  }
  const appointment = await prisma.appointment.findFirst(query);
  return appointment ? [appointment] : [];
}

async function handleReschedule({ tenant, connection, conv, waId, tone, date = null, time = null, keepCurrentTime = false, appointmentId = null }) {
  const phone = waIdToPhone(waId);
  const client = await prisma.client.findFirst({ where: { tenantId: tenant.id, whatsapp: phone } });
  if (!client) {
    const msg = tone === 'tu'
      ? '🤔 *No encontré una reserva próxima a tu nombre*\n\n¿Quieres agendar tu momento? 💛'
      : '🤔 *No encontré una reserva próxima a su nombre*\n\n¿Desea agendar su momento? 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return handleBook({ tenant, connection, conv, waId, tone });
  }

  const appointments = await upcomingAppointmentsForClient(tenant.id, client.id);
  if (!appointments.length) {
    const msg = tone === 'tu'
      ? '📋 *No tienes reservas próximas para cambiar*\n\n¿Quieres agendar tu momento? 💛'
      : '📋 *No tiene reservas próximas para cambiar*\n\n¿Desea agendar su momento? 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  if (!appointmentId && appointments.length > 1) {
    state.setFlowState(waId, {
      flow: 'reschedule',
      reschedule: { step: 'choose_appointment' },
      clientName: client.fullName,
      tone,
      unclearCount: 0,
    });
    const payload = menus.rescheduleAppointmentPicker(appointments, { tone });
    const r = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: '[reprogramar: elegir cita]' });
    return;
  }

  const appointment = appointmentId
    ? appointments.find((candidate) => candidate.id === appointmentId)
    : appointments[0];
  if (!appointment) {
    const msg = tone === 'tu'
      ? '😅 Esa cita ya no está disponible. Elige una de tus citas próximas:'
      : '😅 Esa cita ya no está disponible. Elija una de sus citas próximas:';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    const payload = menus.rescheduleAppointmentPicker(appointments, { tone });
    const listResult = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, listResult, { type: 'interactive', body: '[reprogramar: elegir cita]' });
    return;
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
    reschedule: { ...fs.reschedule, step: 'select_period', date, allAvailableSlots: slots, availableSlots: slots },
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
  return showReschedulePeriodPicker({ tenant, connection, conv, waId, tone, body });
}

async function showReschedulePeriodPicker({ tenant, connection, conv, waId, tone, body }) {
  const fs = state.getFlowState(waId) || {};
  const reschedule = fs.reschedule || {};
  const slots = reschedule.allAvailableSlots || reschedule.availableSlots || [];
  const hasMorning = slotsForPeriod(slots, 'morning').length > 0;
  const hasAfternoon = slotsForPeriod(slots, 'afternoon').length > 0;
  if (hasMorning && hasAfternoon) {
    const payload = menus.timePeriodPicker({ tone });
    if (body) payload.body = { text: body };
    const r = await transport.sendInteractive(connection, waId, payload);
    await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: '[reprogramar: elegir mañana o tarde]' });
    return;
  }
  return handleReschedulePeriodSelected({
    tenant, connection, conv, waId, tone,
    period: hasMorning ? 'morning' : 'afternoon',
  });
}

async function handleReschedulePeriodSelected({ tenant, connection, conv, waId, tone, period }) {
  const fs = state.getFlowState(waId) || {};
  const reschedule = fs.reschedule;
  if (!reschedule?.appointmentId) return handleReschedule({ tenant, connection, conv, waId, tone });
  const availableSlots = slotsForPeriod(reschedule.allAvailableSlots || reschedule.availableSlots, period);
  if (!availableSlots.length) return showReschedulePeriodPicker({ tenant, connection, conv, waId, tone });
  state.setFlowState(waId, {
    ...fs,
    flow: 'reschedule',
    reschedule: { ...reschedule, step: 'select_time', period, availableSlots },
    tone,
    unclearCount: 0,
  });
  return showRescheduleTimeSlots({ tenant, connection, conv, waId, tone });
}

async function showRescheduleTimeSlots({ tenant, connection, conv, waId, tone, page = 0 }) {
  const fs = state.getFlowState(waId) || {};
  const reschedule = fs.reschedule;
  if (!reschedule?.availableSlots?.length) return handleReschedule({ tenant, connection, conv, waId, tone });
  const periodLabel = reschedule.period === 'morning' ? '🌅 Mañana' : '🌆 Tarde';
  const payload = menus.timeSlotList(reschedule.availableSlots, reschedule.serviceName, {
    tone,
    page,
    body: `${periodLabel} · *Horarios para* _${reschedule.serviceName}_`,
  });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, { type: 'interactive', body: `[reprogramar: horarios ${reschedule.period} página ${Number(page) + 1}]` });
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
    await appendConversationLabels(conv, ['cita_reprogramada']);
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
    return handleBook({ tenant, connection, conv, waId, tone });
  }

  state.setFlowState(waId, { clientName: client.fullName });

  const upcoming = await upcomingAppointmentsForClient(tenant.id, client.id, { includeRoom: true });

  if (!upcoming.length) {
    const msg = tone === 'tu'
      ? '📋 *No tienes reservas próximas*\n\n¿Quieres agendar tu momento? 💛'
      : '📋 *No tiene reservas próximas*\n\n¿Desea agendar su momento? 💛';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return handleBook({ tenant, connection, conv, waId, tone });
  }

  const appointmentsSummary = upcoming.map((appointment, index) => {
    const fecha = new Date(appointment.startsAt).toLocaleString('es-EC', {
      timeZone: 'America/Guayaquil', weekday: 'long', day: '2-digit', month: 'long',
      hour: '2-digit', minute: '2-digit',
    });
    const estado = (appointment.status === 'confirmado' || appointment.status === 'pendiente_bot') ? 'confirmada' : 'pendiente de confirmar';
    return `*${index + 1}. ${appointment.service?.name || 'Servicio'}*\n📅 ${capitalize(fecha)}\n🏠 Cabina: ${appointment.room?.name || '—'}\n✅ ${capitalize(estado)}`;
  }).join('\n\n');
  const msg = tone === 'tu'
    ? `📋 *Tus citas próximas en Alma Spa*\n\n${appointmentsSummary}\n\nSi necesitas cambiar alguna, avísanos 💛`
    : `📋 *Sus citas próximas en Alma Spa*\n\n${appointmentsSummary}\n\nSi necesita cambiar alguna, avísenos 💛`;
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
  const actions = menus.appointmentActions({ tone });
  const actionResult = await transport.sendInteractive(connection, waId, actions);
  await recordBotMessage(tenant.id, conv, actionResult, { type: 'interactive', body: '[acciones de mi cita]' });
  state.setFlowState(waId, { flow: 'menu', clientName: client.fullName, tone, unclearCount: 0 });
}

async function handleEscalate({ tenant, connection, conv, waId, tone }) {
  const receptionOpen = isReceptionOpenNow(tenant.config || {});
  const labels = [...new Set([...(conv.labels || []), RECEPTION_LABEL])];

  try {
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: receptionOpen
        ? { labels, botActive: false, botPausedUntil: null, botState: null, status: 'open' }
        : { labels, status: 'open' },
    });
    crmEvents.publish(tenant.id, 'conversation.reception.requested', {
      tenantId: tenant.id,
      conversationId: conv.id,
      receptionOpen,
      labels,
    });
  } catch (err) {
    // La atención humana no debe perderse por un fallo secundario de la etiqueta.
    logBot('warn', 'no se pudo marcar solicitud de recepción', { conversationId: conv.id, error: err.message });
  }

  if (receptionOpen) {
    state.markEscalated(waId);
    state.clearFlowState(waId);
    const msg = tone === 'tu'
      ? '👋 *Te conecto con recepción.*\n\nPor favor, espera un momento; una persona del equipo te atenderá lo antes posible 🌿'
      : '👋 *Le conecto con recepción.*\n\nPor favor, espere un momento; una persona del equipo le atenderá lo antes posible 🌿';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return;
  }

  // Fuera de horario se conserva la etiqueta para que recepción vea el caso,
  // pero Almita sigue disponible si la persona decide continuar por el bot.
  const msg = tone === 'tu'
    ? '🌙 *En este momento recepción está fuera de horario.*\n\nPuedes seguir usando Almita para ver servicios, consultar horarios disponibles o reservar. Si prefieres atención humana, déjanos tu requerimiento y recepción lo revisará en el próximo horario de atención 💛'
    : '🌙 *En este momento recepción está fuera de horario.*\n\nPuede seguir usando Almita para ver servicios, consultar horarios disponibles o reservar. Si prefiere atención humana, déjenos su requerimiento y recepción lo revisará en el próximo horario de atención 💛';
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
}

async function handleBusinessHours({ tenant, connection, conv, waId, tone }) {
  const msg = tone === 'tu'
    ? '🕐 *Nuestro horario de atención*\n\nLunes a sábado:\n🌤️ 9:00 a. m. a 12:00 p. m.\n🌙 3:00 p. m. a 8:00 p. m.\n\nDomingos descansamos 🌿'
    : '🕐 *Nuestro horario de atención*\n\nLunes a sábado:\n🌤️ 9:00 a. m. a 12:00 p. m.\n🌙 3:00 p. m. a 8:00 p. m.\n\nDomingos descansamos 🌿';
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
}

async function handleLocation({ tenant, connection, conv, waId }) {
  const msg = '📍 Estamos en *Juan de Salinas y Av. Héroes de Paquisha.* 🌿';
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
    isReceptionRequest,
    isReceptionOpenNow,
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
    extractRecipientName,
    resolveCalendarDate,
    resolveBookingDate,
    handleSmartBooking,
  },
};
