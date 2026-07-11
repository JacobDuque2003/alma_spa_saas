const prisma = require('../utils/prisma');
const transport = require('./whatsappTransport');
const { previewOf } = require('./whatsappInboxService');
const { phoneToWaId } = require('../utils/phone');

/**
 * Enviado después de createPublicBooking cuando existe conexión activa. El
 * cliente reservó por la web (no por WhatsApp) → no hay ventana abierta → el
 * primer mensaje DEBE ser plantilla. Best-effort: si algo falla (tenant sin
 * conexión, sin plantilla configurada, Meta fuera), se loguea y sigue — el
 * booking en la DB ya está commiteado.
 */
async function notifyBookingCreated(tenantId, client, appointments) {
  try {
    const conn = await transport.loadActiveConnection(tenantId);
    if (!conn) return;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { config: true } });
    const tpl = tenant?.config?.whatsapp?.bookingTemplate;
    const publicBase = process.env.PUBLIC_BASE_URL || tenant?.config?.publicBaseUrl;
    if (!tpl?.name || !tpl?.language || !publicBase) return;

    const first = appointments[0];
    if (!first) return;

    const service = await prisma.service.findUnique({ where: { id: first.serviceId }, select: { name: true } });
    const sanitize = (v) => String(v ?? '').replace(/[\n\r\t]+/g, ' ').slice(0, 60);
    const bodyParams = [client.fullName, service?.name, first.startsAt.toISOString()].map(sanitize);
    const customerWaId = phoneToWaId(client.whatsapp);
    if (!customerWaId) return;

    // Sembrar la conversación en la bandeja: aparece desde el minuto cero, aún
    // sin ventana de 24h abierta (solo se puede responder con plantilla, correcto).
    const conv = await prisma.whatsAppConversation.upsert({
      where: { tenantId_customerWaId: { tenantId, customerWaId } },
      update: {
        clientId: client.id,
        customerName: client.fullName,
        lastOutboundAt: new Date(),
        lastMessageAt: new Date(),
        lastMessagePreview: previewOf(`[Reserva] ${service?.name ?? ''}`),
      },
      create: {
        tenantId,
        clientId: client.id,
        customerWaId,
        customerName: client.fullName,
        lastOutboundAt: new Date(),
        lastMessageAt: new Date(),
        lastMessagePreview: previewOf(`[Reserva] ${service?.name ?? ''}`),
      },
    });

    const message = await prisma.whatsAppMessage.create({
      data: {
        tenantId,
        conversationId: conv.id,
        direction: 'outbound',
        type: 'template',
        status: 'queued',
        templateName: tpl.name,
        templateLang: tpl.language,
      },
    });
    const send = await transport.sendTemplate(conn, customerWaId, {
      name: tpl.name,
      language: tpl.language,
      components: [
        { type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) },
        { type: 'button', sub_type: 'url', index: '0',
          parameters: [{ type: 'text', text: `bookings/${encodeURIComponent(first.confirmationToken)}/confirm` }] },
      ],
    });
    await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: send.ok
        ? { status: 'sent', waMessageId: send.data?.messages?.[0]?.id ?? null }
        : { status: 'failed', errorCode: String(send.errorCode ?? send.status ?? ''), errorTitle: String(send.errorTitle ?? '').slice(0, 250) },
    });
  } catch (err) {
    console.warn('[BOOKING-NOTIFIER] fallo enviando plantilla de reserva:', transport.sanitizeError(err));
  }
}

module.exports = { notifyBookingCreated };
