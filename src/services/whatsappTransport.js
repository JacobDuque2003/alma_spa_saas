const crypto = require('node:crypto');
const prisma = require('../utils/prisma');
const { openWhatsappSecret } = require('../utils/whatsappCredentialCrypto');

const META_GRAPH_URL = 'https://graph.facebook.com/v20.0';
const SEND_TIMEOUT_MS = 10_000;
const MAX_RETRY_ATTEMPTS = 2;

/**
 * Sanea el objeto de error de fetch/Meta antes de loguearlo. Descarta headers
 * (Authorization: Bearer <token> es el bien más valioso a proteger) y bodies
 * de request; solo mensaje corto + status. Ídem la lección aprendida en el
 * diseño descartado de Google Calendar.
 */
function sanitizeError(err) {
  return {
    name: err.name || 'Error',
    message: (err.message || '').slice(0, 500),
    status: err.status,
  };
}

async function loadActiveConnection(tenantId) {
  const conn = await prisma.whatsAppConnection.findUnique({ where: { tenantId } });
  if (!conn || conn.status !== 'activo') return null;
  return conn;
}

/**
 * Descifra el accessToken de un tenant. Uso INTERNO exclusivo del transporte
 * de mensajes y no debe cruzar la frontera hacia un controller/ruta. El guard
 * `whatsappCredentialCryptoImport.guard.test.js` bloquea a nivel de CI cualquier
 * archivo que use `openWhatsappSecret` fuera de este módulo.
 */
function getAccessTokenForSend(conn) {
  return openWhatsappSecret({
    enc: conn.accessTokenEnc,
    iv: conn.accessTokenIv,
    tag: conn.accessTokenTag,
  });
}

/**
 * Descifra el appSecret de un tenant. Uso INTERNO del webhook para verificar
 * la firma HMAC. Mismo criterio de encapsulamiento que el accessToken.
 */
function getAppSecretForVerify(conn) {
  return openWhatsappSecret({
    enc: conn.appSecretEnc,
    iv: conn.appSecretIv,
    tag: conn.appSecretTag,
  });
}

/**
 * Verifica el handshake GET del webhook. Compara el hash del hub.verify_token
 * recibido contra el `verifyTokenHash` de la conexión, con timingSafeEqual sobre
 * buffers de largo fijo (32 bytes = SHA-256). El lookup previo por hash único ya
 * garantiza que solo puede coincidir la conexión correcta.
 */
function verifyWebhookChallenge(conn, hubVerifyToken) {
  if (typeof hubVerifyToken !== 'string' || hubVerifyToken === '') return false;
  const provided = crypto.createHash('sha256').update(hubVerifyToken, 'utf8').digest();
  const stored = conn.verifyTokenHash;
  if (!Buffer.isBuffer(stored) || stored.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(provided, stored);
  } catch (_) {
    return false;
  }
}

async function postToMeta(conn, path, body) {
  const token = getAccessTokenForSend(conn);
  let attempt = 0;
  let lastErr;
  while (attempt <= MAX_RETRY_ATTEMPTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(`${META_GRAPH_URL}/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        return { ok: true, data };
      }
      let detail; try { detail = (await res.json())?.error; } catch (_) { detail = undefined; }
      // 4xx = determinista, no reintentar. 5xx = transitorio, reintentar con backoff.
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, status: res.status, errorCode: detail?.code, errorTitle: detail?.message };
      }
      lastErr = { name: 'HttpError', message: `Meta 5xx (${res.status})`, status: res.status };
    } catch (err) {
      clearTimeout(timer);
      lastErr = sanitizeError(err);
    }
    attempt += 1;
    if (attempt <= MAX_RETRY_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
  return { ok: false, status: lastErr?.status ?? 0, errorTitle: lastErr?.message ?? 'Fallo de red' };
}

async function sendText(conn, toWaId, text) {
  return postToMeta(conn, `${conn.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: toWaId,
    type: 'text',
    text: { body: text },
  });
}

async function sendTemplate(conn, toWaId, { name, language, components }) {
  return postToMeta(conn, `${conn.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: toWaId,
    type: 'template',
    template: {
      name,
      language: { code: language },
      ...(components ? { components } : {}),
    },
  });
}

module.exports = {
  loadActiveConnection,
  getAccessTokenForSend,
  getAppSecretForVerify,
  verifyWebhookChallenge,
  sendText,
  sendTemplate,
  sanitizeError,
};
