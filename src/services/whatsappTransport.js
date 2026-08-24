const crypto = require('node:crypto');

const META_GRAPH_URL = 'https://graph.facebook.com/v20.0';
const SEND_TIMEOUT_MS = 10_000;
const MAX_RETRY_ATTEMPTS = 2;

function sanitizeError(err) {
  return {
    name: err.name || 'Error',
    message: (err.message || '').slice(0, 500),
    status: err.status,
  };
}

// Single-tenant: credenciales de WhatsApp viven en variables de entorno,
// no cifradas en la DB. loadActiveConnection devuelve un objeto sintético
// compatible con la interfaz que usan todos los callers (conn.phoneNumberId).
function loadActiveConnection(_tenantId) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, wabaId: process.env.WHATSAPP_WABA_ID || '' };
}

function getAccessTokenForSend(_conn) {
  return process.env.WHATSAPP_ACCESS_TOKEN;
}

function getAppSecretForVerify(_conn) {
  return process.env.WHATSAPP_APP_SECRET;
}

function verifyWebhookChallenge(hubVerifyToken) {
  const stored = process.env.WHATSAPP_VERIFY_TOKEN;
  if (typeof hubVerifyToken !== 'string' || hubVerifyToken === '') return false;
  if (typeof stored !== 'string' || stored === '') return false;
  const providedBuf = Buffer.from(hubVerifyToken, 'utf8');
  const storedBuf = Buffer.from(stored, 'utf8');
  if (providedBuf.length !== storedBuf.length) return false;
  try {
    return crypto.timingSafeEqual(providedBuf, storedBuf);
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

async function sendInteractive(conn, toWaId, interactivePayload) {
  return postToMeta(conn, `${conn.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: toWaId,
    type: 'interactive',
    interactive: interactivePayload,
  });
}

async function sendImageByMediaId(conn, toWaId, mediaId, caption) {
  return postToMeta(conn, `${conn.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: toWaId,
    type: 'image',
    image: {
      id: mediaId,
      ...(caption ? { caption } : {}),
    },
  });
}

async function uploadMedia(conn, buffer, mimeType) {
  const token = getAccessTokenForSend(conn);
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), `image.${mimeType.split('/')[1] || 'jpg'}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(`${META_GRAPH_URL}/${conn.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      let detail; try { detail = (await res.json())?.error?.message; } catch (_) { detail = undefined; }
      return { ok: false, status: res.status, errorTitle: detail || `Meta media upload ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, mediaId: data.id };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: err.status || 0, errorTitle: sanitizeError(err).message };
  }
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
  sendInteractive,
  sendImageByMediaId,
  uploadMedia,
  sanitizeError,
};
