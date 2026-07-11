const crypto = require('node:crypto');
const express = require('express');
const prisma = require('../../utils/prisma');
const transport = require('../../services/whatsappTransport');
const { previewOf } = require('../../services/whatsappInboxService');
const { waIdToPhone } = require('../../utils/phone');

const router = express.Router({ mergeParams: true });

// Regex de la firma X-Hub-Signature-256: hash SHA-256 en hex minúsculas.
const SIG_RE = /^sha256=[0-9a-f]{64}$/;

/**
 * Verificación en el orden fail-closed que exige AppSec:
 * 1. Cargar Tenant por slug de la URL (fuente confiable, no del body).
 * 2. Cargar WhatsAppConnection activa. Sin conexión → DROP.
 * 3. Descifrar appSecret. Si es nulo/no resoluble → DROP (NUNCA HMAC con "" — H1).
 * 4. Validar el header (existencia + formato) ANTES de comparar.
 * 5. HMAC sobre req.rawBody (bytes crudos exactos — NO re-serializar).
 * 6. timingSafeEqual sobre buffers de igual longitud.
 * Recién con firma válida se responde 200 y se procesa async.
 */
async function loadConnectionOrDrop(req, res) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: req.params.tenantSlug } });
  if (!tenant || !tenant.active) { res.sendStatus(404); return null; }
  const connection = await prisma.whatsAppConnection.findUnique({ where: { tenantId: tenant.id } });
  if (!connection || connection.status !== 'activo') { res.sendStatus(404); return null; }
  return { tenant, connection };
}

router.get('/', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode !== 'subscribe' || typeof token !== 'string') return res.sendStatus(403);

  const ctx = await loadConnectionOrDrop(req, res);
  if (!ctx) return;

  if (!transport.verifyWebhookChallenge(ctx.connection, token)) return res.sendStatus(403);
  res.type('text/plain').status(200).send(String(challenge ?? ''));
});

router.post('/', async (req, res) => {
  const ctx = await loadConnectionOrDrop(req, res);
  if (!ctx) return;

  let appSecret;
  try {
    appSecret = transport.getAppSecretForVerify(ctx.connection);
  } catch (err) {
    console.warn('[WA-WEBHOOK] falla al descifrar appSecret del tenant', ctx.tenant.slug, transport.sanitizeError(err));
    return res.sendStatus(500);
  }
  if (typeof appSecret !== 'string' || appSecret === '') {
    // H1: secreto vacío/no resoluble → RECHAZAR, nunca HMAC con clave vacía.
    return res.sendStatus(401);
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

  // Firma válida. Reconocer INMEDIATAMENTE — procesar async.
  res.sendStatus(200);
  setImmediate(() => {
    processWebhookPayload(ctx.tenant, ctx.connection, req.body).catch((err) => {
      console.error('[WA-WEBHOOK] fallo procesando payload:', transport.sanitizeError(err));
    });
  });
});

/**
 * Procesamiento async del payload. Iterar TODOS los entry[].changes[] (no solo
 * [0]) porque Meta puede batchear. Cross-check que cada change corresponda al
 * phoneNumberId de la conexión (defense-in-depth: la firma ya garantiza que
 * el body no fue alterado, pero un tenant no debería recibir datos de otro
 * incluso si por error apuntara su webhook a nuestra URL).
 */
async function processWebhookPayload(tenant, connection, body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      if (!value) continue;
      const phoneId = value?.metadata?.phone_number_id;
      if (phoneId && phoneId !== connection.phoneNumberId) continue;

      if (Array.isArray(value.messages)) {
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
  if (!waMessageId) return;
  if (await prisma.whatsAppMessage.findUnique({ where: { waMessageId } })) return; // idempotencia
  const fromWaId = message.from;
  if (!fromWaId) return;

  const contactName = Array.isArray(contacts) ? contacts.find((c) => c?.wa_id === fromWaId)?.profile?.name ?? null : null;
  const bodyText = message.type === 'text' ? message.text?.body ?? null : null;
  const waTs = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date();

  // Auto-link best-effort al Client existente por whatsapp (NO se auto-crea Client).
  const client = await prisma.client.findFirst({
    where: { tenantId: tenant.id, whatsapp: waIdToPhone(fromWaId) },
  });

  // Asegurar que la conversación exista (upsert sin incrementar unreadCount
  // todavía — eso se hace DESPUÉS del insert del mensaje para evitar inflar
  // el contador en entregas duplicadas concurrentes).
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
  } catch (err) {
    if (err.code !== 'P2002') throw err;
    return; // duplicado — no actualizar la conversación
  }

  await prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: {
      lastInboundAt: waTs,
      lastMessageAt: waTs,
      lastMessagePreview: previewOf(bodyText ?? `[${message.type}]`),
      unreadCount: { increment: 1 },
    },
  });
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
}

function mapType(t) {
  const valid = ['text', 'template', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'interactive'];
  return valid.includes(t) ? t : 'other';
}

module.exports = router;
module.exports.processWebhookPayload = processWebhookPayload; // exportado para tests
