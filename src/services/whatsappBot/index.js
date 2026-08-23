// Orquestador del bot de WhatsApp — Fase 1 (sin IA, sin migración).
//
// handleInboundMessage() se invoca desde webhooks/whatsapp.js DESPUÉS de que
// se insertó el WhatsAppMessage inbound. Devuelve void: los efectos son (a)
// mensajes salientes vía transport.sendXxx, (b) mutaciones al Map de estado
// en state.js, (c) potencial insert de WhatsAppMessage outbound.
//
// Reglas de "el bot no responde" (best-effort, en orden):
//  1. Rate limit por número excedido → silencio (con posible aviso una vez).
//  2. Conversación escalada por la propia clienta ("hablar con recepción").
//  3. Algún outbound previo tiene sentByUserId != null → recepción ya intervino.

const prisma = require('../../utils/prisma');
const transport = require('../whatsappTransport');
const serviceService = require('../serviceService');
const clientService = require('../clientService');
const state = require('./state');
const rateLimit = require('./rateLimit');
const menus = require('./menus');
const { waIdToPhone } = require('../../utils/phone');

const RESERVAR_URL_BASE = process.env.PUBLIC_BASE_URL
  ? `${process.env.PUBLIC_BASE_URL}/reservar/`
  : 'https://tienes-que-configurar-PUBLIC_BASE_URL/reservar/';

async function humanAlreadyReplied(tenantId, conversationId) {
  const anyHuman = await prisma.whatsAppMessage.findFirst({
    where: { tenantId, conversationId, direction: 'outbound', sentByUserId: { not: null } },
    select: { id: true },
  });
  return !!anyHuman;
}

// Registrar el outbound del bot en WhatsAppMessage. sentByUserId: null
// (característica del bot). Best-effort: si falla, no rompe el flujo — el
// mensaje ya salió a la clienta, el registro es para la Bandeja.
async function recordBotMessage(tenantId, conv, sendResult, { type = 'text', body = null }) {
  if (!sendResult?.ok) return;
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
  } catch (err) {
    console.warn('[BOT] falla al registrar outbound:', transport.sanitizeError(err));
  }
}

function detectTone(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  // Uso "tú" explícito (tú, tu, tuyo, contigo) — evita falso positivo con "usted".
  if (/\b(t[uú]|contigo|tuy[oa]|tienes|puedes|quer[eé]s|querías)\b/.test(t)) return 'tu';
  if (/\busted\b/.test(t)) return 'usted';
  return null;
}

function isMenuRequest(text) {
  // El PM aprobó "cualquier mensaje inbound dispara el menú" — sin palabras clave.
  // Aún así, esta función queda para futuras fases si se quiere restringir.
  return true;
}

/**
 * Punto de entrada del bot. tenant/connection ya validados por el webhook;
 * conv es el WhatsAppConversation recién actualizado; incoming es el objeto
 * del mensaje inbound crudo de Meta.
 */
async function handleInboundMessage({ tenant, connection, conv, incoming }) {
  const waId = conv.customerWaId;

  // Regla 3: recepción ya respondió → cesión permanente.
  if (await humanAlreadyReplied(tenant.id, conv.id)) return;
  // Regla 2: escalada previamente por la clienta.
  if (state.isEscalated(waId)) return;

  // Regla 1: rate limit.
  const gate = rateLimit.check(waId);
  if (!gate.allowed) {
    if (gate.warn) {
      const warn = 'Recibí muchos mensajes seguidos, dame un momento y vuelvo a responder.';
      const r = await transport.sendText(connection, waId, warn);
      await recordBotMessage(tenant.id, conv, r, { body: warn });
    }
    return;
  }

  // Detectar tono a partir del texto inbound (si hubo).
  const bodyText = incoming.type === 'text' ? incoming.text?.body ?? null : null;
  const priorState = state.getFlowState(waId) || {};
  const tone = detectTone(bodyText) || priorState.tone || 'usted';

  // Determinar la intención del mensaje.
  //   1) interactive.list_reply.id / interactive.button_reply.id → seleccion de menú
  //   2) mensaje text → menú principal (regla del PM: siempre dispara menú)
  //   3) cualquier otro tipo → menú principal + aviso "solo entiendo texto y botones"
  const interactive = incoming.interactive;
  const listId = interactive?.list_reply?.id;
  const buttonId = interactive?.button_reply?.id;
  const selectionId = listId || buttonId;

  if (selectionId) {
    return handleSelection({ tenant, connection, conv, waId, tone, selectionId });
  }

  // Sin selección: menú principal.
  return sendMainMenu({ tenant, connection, conv, waId, tone });
}

async function sendMainMenu({ tenant, connection, conv, waId, tone }) {
  state.setFlowState(waId, { flow: 'menu', tone });
  const payload = menus.mainMenu({ tone });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, {
    type: 'interactive',
    body: '[menú principal]',
  });
}

async function handleSelection({ tenant, connection, conv, waId, tone, selectionId }) {
  // Navegación "Volver al menú" (reply button).
  if (selectionId === menus.NAV_BACK_MENU) {
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  // Menú principal.
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

  // Servicio del catálogo.
  if (selectionId.startsWith(menus.SERVICE_PREFIX)) {
    const serviceId = selectionId.slice(menus.SERVICE_PREFIX.length);
    return handleServiceDetail({ tenant, connection, conv, waId, tone, serviceId });
  }

  // Selección desconocida — vuelve al menú.
  return sendMainMenu({ tenant, connection, conv, waId, tone });
}

async function handleListServices({ tenant, connection, conv, waId, tone }) {
  const svcs = await prisma.service.findMany({
    where: { tenantId: tenant.id, active: true },
    select: { id: true, name: true, category: true, priceUsd: true, durationMins: true, active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
  state.setFlowState(waId, { flow: 'listing_services', tone });
  const payload = menus.servicesList(svcs, { tone });
  const r = await transport.sendInteractive(connection, waId, payload);
  await recordBotMessage(tenant.id, conv, r, {
    type: 'interactive',
    body: `[lista de ${svcs.length} servicios]`,
  });
}

async function handleServiceDetail({ tenant, connection, conv, waId, tone, serviceId }) {
  // Pseudo-actor para permisos: el bot vive con el tenantId del webhook.
  // getServiceImage/getService ya usan assertTenantScope, así que le pasamos
  // un actor con role 'dueno' del mismo tenant (no lo usamos para escribir,
  // solo lectura). Es equivalente a lo que ya hace bookingNotifier.
  const botActor = { id: 'bot', role: 'dueno', tenantId: tenant.id, email: 'bot@internal' };
  const svc = await serviceService.getService(botActor, serviceId);
  if (!svc || svc.active === false) {
    // Servicio inválido o inactivo — vuelve al menú de servicios.
    await transport.sendText(connection, waId, tone === 'tu'
      ? 'Ese servicio ya no está disponible. Te muestro los actuales.'
      : 'Ese servicio ya no está disponible. Le muestro los actuales.');
    return handleListServices({ tenant, connection, conv, waId, tone });
  }

  // Caption con precio + duración + descripción (según el PM: si no hay
  // descripción, sale solo el nombre y datos — sin mencionar la falta).
  const descLine = svc.description ? `\n\n${svc.description}` : '';
  const caption = `${svc.name}\n$${Number(svc.priceUsd).toFixed(2)} · ${svc.durationMins || 60} min${descLine}`;

  // Si el servicio tiene imagen, la subimos a Meta y enviamos type:image
  // con caption. Si no tiene, solo texto — sin mencionar la falta de foto.
  const imgRes = await serviceService.getServiceImage(botActor, serviceId);
  const image = imgRes?.image;
  if (image?.data && image?.mimeType) {
    const uploaded = await transport.uploadMedia(connection, image.data, image.mimeType);
    if (uploaded.ok) {
      const sent = await transport.sendImageByMediaId(connection, waId, uploaded.mediaId, caption);
      await recordBotMessage(tenant.id, conv, sent, { type: 'image', body: `[foto] ${caption.slice(0, 100)}` });
    } else {
      // Fallback: la subida falló, mandamos solo texto (sin mencionar el fallo).
      console.warn('[BOT] uploadMedia falló, fallback a texto:', uploaded);
      const r = await transport.sendText(connection, waId, caption);
      await recordBotMessage(tenant.id, conv, r, { body: caption });
    }
  } else {
    const r = await transport.sendText(connection, waId, caption);
    await recordBotMessage(tenant.id, conv, r, { body: caption });
  }

  // Botón "Ver menú" para navegar.
  const backPayload = menus.backToMenuButton({ tone });
  const r2 = await transport.sendInteractive(connection, waId, backPayload);
  await recordBotMessage(tenant.id, conv, r2, { type: 'interactive', body: '[botón volver]' });
  state.setFlowState(waId, { flow: 'service_detail', lastServiceId: serviceId, tone });
}

async function handleBook({ tenant, connection, conv, waId, tone }) {
  const url = `${RESERVAR_URL_BASE}${tenant.slug}`;
  const msg = tone === 'tu'
    ? `Puedes reservar en línea aquí:\n${url}\n\nElige tu servicio, día y horario. Cualquier duda, respóndenos por acá.`
    : `Puede reservar en línea aquí:\n${url}\n\nElija su servicio, día y horario. Cualquier duda, respóndanos por acá.`;
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
  state.setFlowState(waId, { flow: 'menu', tone });
}

async function handleMyAppointment({ tenant, connection, conv, waId, tone }) {
  const phone = waIdToPhone(waId);
  const client = await prisma.client.findFirst({ where: { tenantId: tenant.id, whatsapp: phone } });
  if (!client) {
    const msg = tone === 'tu'
      ? 'No encuentro citas a tu nombre. Te muestro el menú por si quieres reservar.'
      : 'No encuentro citas a su nombre. Le muestro el menú por si desea reservar.';
    const r = await transport.sendText(connection, waId, msg);
    await recordBotMessage(tenant.id, conv, r, { body: msg });
    return sendMainMenu({ tenant, connection, conv, waId, tone });
  }

  // Próxima cita activa (pendiente o confirmada) desde ahora.
  const next = await prisma.appointment.findFirst({
    where: { tenantId: tenant.id, clientId: client.id, status: { in: ['pendiente', 'confirmado'] }, startsAt: { gte: new Date() } },
    orderBy: { startsAt: 'asc' },
    include: { service: true, room: true },
  });

  if (!next) {
    const msg = tone === 'tu'
      ? 'No tienes citas próximas. ¿Quieres reservar una?'
      : 'No tiene citas próximas. ¿Desea reservar una?';
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
    ? `Tu próxima cita:\n\n${next.service?.name}\n${fecha}\nCabina: ${next.room?.name || '—'}\nEstado: ${estado}\n\nSi necesitas cambiar algo, avísanos.`
    : `Su próxima cita:\n\n${next.service?.name}\n${fecha}\nCabina: ${next.room?.name || '—'}\nEstado: ${estado}\n\nSi necesita cambiar algo, avísenos.`;
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
  state.setFlowState(waId, { flow: 'menu', tone });
}

async function handleEscalate({ tenant, connection, conv, waId, tone }) {
  state.markEscalated(waId);
  const msg = tone === 'tu'
    ? 'Aviso a la recepción para que te contacte por acá lo antes posible. Gracias por escribir 🌿'
    : 'Aviso a la recepción para que le contacte por acá lo antes posible. Gracias por escribir 🌿';
  const r = await transport.sendText(connection, waId, msg);
  await recordBotMessage(tenant.id, conv, r, { body: msg });
  state.clearFlowState(waId);
}

module.exports = {
  handleInboundMessage,
  // exports internos para tests
  _internals: {
    detectTone,
    humanAlreadyReplied,
    isMenuRequest,
    handleSelection,
    sendMainMenu,
    handleListServices,
    handleServiceDetail,
    handleBook,
    handleMyAppointment,
    handleEscalate,
  },
};
