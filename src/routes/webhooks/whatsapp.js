const crypto = require('node:crypto');
const express = require('express');
const prisma = require('../../utils/prisma');
const transport = require('../../services/whatsappTransport');
const { previewOf } = require('../../services/whatsappInboxService');
const { waIdToPhone } = require('../../utils/phone');
const bot = require('../../services/whatsappBot');

const router = express.Router({ mergeParams: true });

const SIG_RE = /^sha256=[0-9a-f]{64}$/;

function safeTail(value, size = 4) {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return str.length <= size ? str : str.slice(-size);
}

function safeTenant(tenant) {
  return tenant?.slug || tenant?.id || 'unknown';
}

function logWebhook(level, event, data = {}) {
  const payload = JSON.stringify(data);
  console[level](`[WA-WEBHOOK] ${event} ${payload}`);
}

function summarizePayload(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  let changes = 0;
  let messages = 0;
  let statuses = 0;

  for (const entry of entries) {
    const entryChanges = Array.isArray(entry?.changes) ? entry.changes : [];
    changes += entryChanges.length;
    for (const change of entryChanges) {
      const value = change?.value;
      if (Array.isArray(value?.messages)) messages += value.messages.length;
      if (Array.isArray(value?.statuses)) statuses += value.statuses.length;
    }
  }

  return { entries: entries.length, changes, messages, statuses };
}

async function loadTenantOrDrop(req, res) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: req.params.tenantSlug } });
  if (!tenant || !tenant.active) { res.sendStatus(404); return null; }
  return tenant;
}

router.get('/', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode !== 'subscribe' || typeof token !== 'string') return res.sendStatus(403);

  const tenant = await loadTenantOrDrop(req, res);
  if (!tenant) return;

  if (!transport.verifyWebhookChallenge(token)) return res.sendStatus(403);
  res.type('text/plain').status(200).send(String(challenge ?? ''));
});

router.post('/', async (req, res) => {
  const tenant = await loadTenantOrDrop(req, res);
  if (!tenant) return;

  const appSecret = transport.getAppSecretForVerify();
  if (typeof appSecret !== 'string' || appSecret === '') {
    return res.sendStatus(500);
  }

  const header = req.get('x-hub-signature-256');
  if (typeof header !== 'string' || !SIG_RE.test(header)) return res.sendStatus(401);
  const raw = req.rawBody;
  if (!Buffer.isBuffer(raw) || raw.length === 0) return res.sendStatus(400);

  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
  const providedBuf = Buffer.from(header, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) return res.sendStatus(401);
  let valid = false;
  try { valid = crypto.timingSafeEqual(providedBuf, expectedBuf); } catch (_) { valid = false; }
  if (!valid) return res.sendStatus(401);

  const connection = transport.loadActiveConnection(tenant.id);
  logWebhook('info', 'payload aceptado', {
    tenant: safeTenant(tenant),
    ...summarizePayload(req.body),
    connectionReady: Boolean(connection),
    phoneNumberConfigured: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    tokenConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
  });

  res.sendStatus(200);

  setImmediate(() => {
    processWebhookPayload(tenant, connection, req.body).catch((err) => {
      console.error('[WA-WEBHOOK] fallo procesando payload:', transport.sanitizeError(err));
    });
  });
});

async function processWebhookPayload(tenant, connection, body) {
  const envPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  if (entries.length === 0) {
    logWebhook('info', 'payload sin entradas procesables', { tenant: safeTenant(tenant) });
    return;
  }

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      if (!value) continue;
      const phoneId = value?.metadata?.phone_number_id;
      const messageCount = Array.isArray(value.messages) ? value.messages.length : 0;
      const statusCount = Array.isArray(value.statuses) ? value.statuses.length : 0;

      logWebhook('info', 'cambio recibido', {
        tenant: safeTenant(tenant),
        field: change?.field ?? null,
        messages: messageCount,
        statuses: statusCount,
        phoneNumberIdTail: safeTail(phoneId),
        envPhoneNumberIdTail: safeTail(envPhoneId),
        connectionReady: Boolean(connection),
      });

      if (phoneId && envPhoneId && phoneId !== envPhoneId) {
        logWebhook('warn', 'omitido por phone_number_id distinto', {
          tenant: safeTenant(tenant),
          phoneNumberIdTail: safeTail(phoneId),
          envPhoneNumberIdTail: safeTail(envPhoneId),
        });
        continue;
      }

      if (Array.isArray(value.messages)) {
        if (!connection) {
          logWebhook('warn', 'conexión incompleta para responder bot', {
            tenant: safeTenant(tenant),
            phoneNumberConfigured: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
            tokenConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
          });
        }
        for (const message of value.messages) {
          try { await processInboundMessage(tenant, message, value.contacts); }
          catch (err) { console.error('[WA-WEBHOOK] inbound msg fallo:', transport.sanitizeError(err)); }
        }
      }
      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          try { await processDeliveryStatus(tenant, status); }
          catch (err) { console.error('[WA-WEBHOOK] status fallo:', transport.sanitizeError(err)); }
        }
      }
    }
  }
}

const RANK = { queued: 1, sent: 2, delivered: 3, read: 4, failed: 5 };

async function processInboundMessage(tenant, message, contacts) {
  const waMessageId = message?.id;
  if (!waMessageId) {
    logWebhook('warn', 'mensaje sin id omitido', { tenant: safeTenant(tenant), type: message?.type ?? null });
    return;
  }
  if (await prisma.whatsAppMessage.findUnique({ where: { waMessageId } })) {
    logWebhook('info', 'mensaje duplicado omitido', {
      tenant: safeTenant(tenant),
      messageIdTail: safeTail(waMessageId, 8),
    });
    return;
  }
  const fromWaId = message.from;
  if (!fromWaId) {
    logWebhook('warn', 'mensaje sin remitente omitido', {
      tenant: safeTenant(tenant),
      messageIdTail: safeTail(waMessageId, 8),
    });
    return;
  }

  logWebhook('info', 'mensaje entrante recibido', {
    tenant: safeTenant(tenant),
    type: message.type,
    messageIdTail: safeTail(waMessageId, 8),
    waIdTail: safeTail(fromWaId),
  });

  const contactName = Array.isArray(contacts) ? contacts.find((c) => c?.wa_id === fromWaId)?.profile?.name ?? null : null;
  const bodyText = message.type === 'text' ? message.text?.body ?? null : null;
  const waTs = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date();

  const client = await prisma.client.findFirst({
    where: { tenantId: tenant.id, whatsapp: waIdToPhone(fromWaId) },
  });

  const conv = await prisma.whatsAppConversation.upsert({
    where: { tenantId_customerWaId: { tenantId: tenant.id, customerWaId: fromWaId } },
    update: {
      customerName: contactName ?? undefined,
      ...(client ? { clientId: client.id } : {}),
    },
    create: {
      tenantId: tenant.id,
      clientId: client?.id ?? null,
      customerWaId: fromWaId,
      customerName: contactName,
      lastInboundAt: waTs,
      lastMessageAt: waTs,
      lastMessagePreview: previewOf(bodyText ?? `[${message.type}]`),
      unreadCount: 0,
    },
  });

  try {
    await prisma.whatsAppMessage.create({
      data: {
        tenantId: tenant.id,
        conversationId: conv.id,
        direction: 'inbound',
        type: mapType(message.type),
        status: 'received',
        waMessageId,
        body: bodyText,
        mediaId: message[message.type]?.id ?? null,
        waTimestamp: waTs,
      },
    });
    logWebhook('info', 'mensaje guardado', {
      tenant: safeTenant(tenant),
      conversationId: conv.id,
      clientMatched: Boolean(client),
      type: mapType(message.type),
      messageIdTail: safeTail(waMessageId, 8),
    });
  } catch (err) {
    if (err.code !== 'P2002') throw err;
    logWebhook('info', 'mensaje duplicado por carrera omitido', {
      tenant: safeTenant(tenant),
      messageIdTail: safeTail(waMessageId, 8),
    });
    return;
  }

  const updatedConv = await prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: {
      lastInboundAt: waTs,
      lastMessageAt: waTs,
      lastMessagePreview: previewOf(bodyText ?? `[${message.type}]`),
      unreadCount: { increment: 1 },
    },
  });

  try {
    const connection = transport.loadActiveConnection(tenant.id);
    if (connection) {
      logWebhook('info', 'bot invocado', {
        tenant: safeTenant(tenant),
        conversationId: updatedConv.id,
        waIdTail: safeTail(fromWaId),
      });
      await bot.handleInboundMessage({ tenant, connection, conv: updatedConv, incoming: message });
    } else {
      logWebhook('warn', 'bot no invocado por conexión incompleta', {
        tenant: safeTenant(tenant),
        phoneNumberConfigured: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
        tokenConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      });
    }
  } catch (err) {
    console.warn('[BOT] handleInboundMessage falló:', transport.sanitizeError(err));
  }
}

async function processDeliveryStatus(tenant, status) {
  const waMessageId = status?.id;
  if (!waMessageId) return;
  const nextStatus = status.status;
  if (!(nextStatus in RANK)) return;

  const errorCode = status.errors?.[0]?.code ? String(status.errors[0].code) : null;
  const errorTitle = status.errors?.[0]?.title ? String(status.errors[0].title).slice(0, 250) : null;

  const lowerStatuses = Object.entries(RANK)
    .filter(([, r]) => r < RANK[nextStatus])
    .map(([s]) => s);

  const whereStatuses = nextStatus === 'failed'
    ? Object.keys(RANK).filter((s) => s !== 'failed')
    : lowerStatuses;
  if (whereStatuses.length === 0) return;

  await prisma.$executeRaw`
    UPDATE "WhatsAppMessage"
    SET status = ${nextStatus}::"WhatsAppMessageStatus",
        "errorCode" = ${errorCode}, "errorTitle" = ${errorTitle}
    WHERE "waMessageId" = ${waMessageId}
      AND "tenantId" = ${tenant.id}
      AND status::text = ANY(${whereStatuses})
  `;
  logWebhook('info', 'estado de entrega procesado', {
    tenant: safeTenant(tenant),
    status: nextStatus,
    messageIdTail: safeTail(waMessageId, 8),
    hasError: Boolean(errorCode || errorTitle),
  });
}

function mapType(t) {
  const valid = ['text', 'template', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'interactive'];
  return valid.includes(t) ? t : 'other';
}

module.exports = router;
module.exports.processWebhookPayload = processWebhookPayload;
