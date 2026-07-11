const crypto = require('node:crypto');
const prisma = require('../utils/prisma');
const { sealWhatsappSecret } = require('../utils/whatsappCredentialCrypto');
const { BadRequestError } = require('../utils/errors');
const { resolveTenantId } = require('../utils/tenantScope');

const META_GRAPH_URL = 'https://graph.facebook.com/v20.0';
const META_VALIDATION_TIMEOUT_MS = 10_000;

function requireStringField(data, field) {
  if (typeof data[field] !== 'string' || data[field].trim() === '') {
    throw new BadRequestError(`${field} es requerido`);
  }
}

/**
 * Ping a Meta para confirmar que el par (phoneNumberId, accessToken) funciona
 * ANTES de marcar la conexión como activa. Si Meta rechaza (401/403/404 =
 * credenciales/número inválidos), guardamos status=error + lastError; si hay un
 * problema de red o Meta responde 5xx, marcamos error también pero con motivo
 * distinto — el operador ve inmediatamente por qué falló.
 */
async function validateAgainstMeta(phoneNumberId, accessToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), META_VALIDATION_TIMEOUT_MS);
  try {
    const res = await fetch(`${META_GRAPH_URL}/${phoneNumberId}?fields=verified_name,display_phone_number`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail;
      try { detail = (await res.json())?.error?.message; } catch (_) { detail = undefined; }
      return { ok: false, error: `Meta rechazó las credenciales (HTTP ${res.status})${detail ? ': ' + detail : ''}` };
    }
    const body = await res.json();
    return { ok: true, displayPhone: body.display_phone_number ?? null };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, error: 'Timeout al validar contra Meta (10s)' };
    return { ok: false, error: `Error de red al validar contra Meta: ${err.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

function sha256Bytes(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest();
}

/**
 * Conecta (o reemplaza) la conexión de WhatsApp del tenant. En Modelo B los 5
 * campos son requeridos: phoneNumberId, wabaId, accessToken, appSecret,
 * verifyToken. Todo lo secreto se cifra o hashea ANTES de tocar la DB; el token
 * plaintext nunca queda en memoria más allá de esta función.
 *
 * Reconectar = reemplazar (upsert por tenantId @unique). Nunca hay endpoint que
 * lea el token viejo para pre-cargarlo en un form — cambiar = pegar de nuevo.
 */
async function replaceConnection(actor, data) {
  const tenantId = resolveTenantId(actor, data.tenantId);
  if (!tenantId) {
    throw new BadRequestError('tenantId es requerido');
  }
  requireStringField(data, 'phoneNumberId');
  requireStringField(data, 'wabaId');
  requireStringField(data, 'accessToken');
  requireStringField(data, 'appSecret');
  requireStringField(data, 'verifyToken');

  // Verificar unicidad global de phoneNumberId ANTES de intentar el upsert
  // (mensaje amigable en vez de un P2002 crudo). Si es el mismo tenant, no importa.
  const existingByPhone = await prisma.whatsAppConnection.findUnique({
    where: { phoneNumberId: data.phoneNumberId },
  });
  if (existingByPhone && existingByPhone.tenantId !== tenantId) {
    throw new BadRequestError('Ese número ya está conectado a otra cuenta');
  }

  const validation = await validateAgainstMeta(data.phoneNumberId, data.accessToken);
  const accessToken = sealWhatsappSecret(data.accessToken);
  const appSecret = sealWhatsappSecret(data.appSecret);
  const verifyTokenHash = sha256Bytes(data.verifyToken);

  const shared = {
    phoneNumberId: data.phoneNumberId,
    wabaId: data.wabaId,
    displayPhone: validation.ok ? validation.displayPhone : null,
    accessTokenEnc: accessToken.enc,
    accessTokenIv: accessToken.iv,
    accessTokenTag: accessToken.tag,
    appSecretEnc: appSecret.enc,
    appSecretIv: appSecret.iv,
    appSecretTag: appSecret.tag,
    verifyTokenHash,
    status: validation.ok ? 'activo' : 'error',
    lastError: validation.ok ? null : validation.error,
    lastVerifiedAt: validation.ok ? new Date() : null,
  };

  try {
    await prisma.whatsAppConnection.upsert({
      where: { tenantId },
      update: shared,
      create: { tenantId, ...shared, connectedAt: new Date() },
    });
  } catch (err) {
    if (err.code === 'P2002' && String(err.meta?.target ?? '').includes('phoneNumberId')) {
      throw new BadRequestError('Ese número ya está conectado a otra cuenta');
    }
    throw err;
  }

  // El endpoint devuelve solo metadata segura — nunca token/appSecret/verifyToken.
  return getConnectionStatus(actor, tenantId);
}

/**
 * Metadata NO sensible para el panel. Hace un SELECT explícito de columnas
 * seguras — físicamente imposible que el resultado contenga los campos *Enc/*Iv/
 * *Tag ni el hash del verifyToken. Es lo que respalda GET /settings/whatsapp/status.
 */
async function getConnectionStatus(actor, tenantIdFromRoute) {
  const tenantId = actor.role === 'superadmin' ? (tenantIdFromRoute ?? actor.tenantId) : actor.tenantId;
  if (!tenantId) return { connected: false };

  const row = await prisma.whatsAppConnection.findUnique({
    where: { tenantId },
    select: {
      phoneNumberId: true,
      wabaId: true,
      displayPhone: true,
      status: true,
      lastError: true,
      lastVerifiedAt: true,
      connectedAt: true,
    },
  });
  if (!row) return { connected: false };

  return {
    connected: true,
    phoneNumberId: row.phoneNumberId,
    wabaId: row.wabaId,
    displayPhone: row.displayPhone,
    status: row.status,
    lastError: row.lastError,
    lastVerifiedAt: row.lastVerifiedAt,
    connectedAt: row.connectedAt,
  };
}

async function disconnect(actor) {
  const tenantId = actor.tenantId;
  if (!tenantId) {
    throw new BadRequestError('tenantId es requerido');
  }
  await prisma.whatsAppConnection.deleteMany({ where: { tenantId } });
  return { connected: false };
}

module.exports = { replaceConnection, getConnectionStatus, disconnect };
