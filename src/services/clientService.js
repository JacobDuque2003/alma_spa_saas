const prisma = require('../utils/prisma');
const { assertTenantScope } = require('../utils/tenantScope');
const { normalizePhone, isValidE164 } = require('../utils/phone');
const { BadRequestError } = require('../utils/errors');

/**
 * Validación básica de email — RFC 5322 simplificado. No intenta cubrir
 * todos los edge-cases pero filtra basura evidente y entradas maliciosas.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

/**
 * Carga el Client (siempre existe, a diferencia de ClientIntake) para derivar
 * el tenant y validar acceso ANTES de cualquier operación sobre sub-recursos
 * del cliente (anamnesis, tratamientos, planes, saldo). Devuelve null si no
 * existe (la ruta responde 404); lanza ForbiddenTenantError (403) si el
 * cliente es de otro tenant. Helper compartido por los servicios de Fase 4.
 */
async function loadClientForActor(actor, clientId) {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return null;
  assertTenantScope(actor, client.tenantId);
  return client;
}


const CLIENT_SAFE_SELECT = {
  id: true,
  tenantId: true,
  fullName: true,
  whatsapp: true,
  email: true,
  active: true,
  createdAt: true,
  updatedAt: true,
};


function toClientSafeDto(client) {
  if (!client) return client;
  return {
    id: client.id,
    tenantId: client.tenantId,
    fullName: client.fullName,
    whatsapp: client.whatsapp,
    email: client.email,
    active: client.active,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

async function listClients(actor, query = {}) {
  const where = {};
  if (actor.role === 'superadmin') {
    if (query.tenantId) where.tenantId = query.tenantId;
  } else {
    where.tenantId = actor.tenantId;
  }

  if (query.q) {
    const q = String(query.q).trim();
    if (q) {
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { whatsapp: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  const clients = await prisma.client.findMany({
    where,
    select: CLIENT_SAFE_SELECT,
    orderBy: [{ fullName: 'asc' }, { createdAt: 'desc' }],
    take: limit,
  });
  return clients.map(toClientSafeDto);
}

async function getClient(actor, clientId) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: CLIENT_SAFE_SELECT,
  });
  if (!client) return null;
  assertTenantScope(actor, client.tenantId);
  return toClientSafeDto(client);
}

async function lookupClient(tenantId, whatsapp) {
  const client = await prisma.client.findUnique({
    where: { tenantId_whatsapp: { tenantId, whatsapp } },
    include: { intake: true },
  });

  if (!client) {
    return { exists: false, requiresIntake: true };
  }

  const requiresIntake = !client.intake || !client.intake.consentSigned;
  return { exists: true, clientId: client.id, requiresIntake };
}

/**
 * Upsert dentro de una transacción (el caller decide el tx) — el cliente
 * se crea o actualiza como parte de la misma operación atómica que crea
 * su ClientIntake y sus Appointment.
 */
async function upsertClient(tx, tenantId, { fullName, whatsapp, email }) {
  const normalized = normalizePhone(whatsapp);
  return tx.client.upsert({
    where: { tenantId_whatsapp: { tenantId, whatsapp: normalized } },
    update: { fullName, email },
    create: { tenantId, fullName, whatsapp: normalized, email },
  });
}

async function createClient(actor, data) {
  const tenantId = actor.role === 'superadmin' ? (data.tenantId || actor.tenantId) : actor.tenantId;
  if (!tenantId) throw new BadRequestError('tenantId es requerido');
  if (!data.fullName || !data.whatsapp) {
    throw new BadRequestError('fullName y whatsapp son requeridos');
  }
  const whatsapp = normalizePhone(data.whatsapp);
  if (!isValidE164(whatsapp)) {
    throw new BadRequestError('Formato de WhatsApp inválido. Use formato E.164 (ej: +593999000001)');
  }
  if (data.email && !isValidEmail(data.email)) {
    throw new BadRequestError('Formato de email inválido');
  }
  const client = await prisma.client.create({
    data: {
      tenantId,
      fullName: String(data.fullName).trim(),
      whatsapp,
      email: data.email ? String(data.email).trim().toLowerCase() : null,
    },
    select: CLIENT_SAFE_SELECT,
  });
  return toClientSafeDto(client);
}

async function updateClient(actor, clientId, changes) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;

  const data = {};
  if (changes.fullName !== undefined) {
    if (typeof changes.fullName !== 'string' || changes.fullName.trim().length === 0) {
      throw new BadRequestError('fullName debe ser un string no vacío');
    }
    data.fullName = changes.fullName.trim();
  }
  if (changes.email !== undefined) {
    if (changes.email) {
      if (!isValidEmail(changes.email)) {
        throw new BadRequestError('Formato de email inválido');
      }
      data.email = changes.email.trim().toLowerCase();
    } else {
      data.email = null;
    }
  }
  if (changes.whatsapp !== undefined) {
    const normalized = normalizePhone(changes.whatsapp);
    if (!isValidE164(normalized)) {
      throw new BadRequestError('Formato de WhatsApp inválido. Use formato E.164 (ej: +593999000001)');
    }
    data.whatsapp = normalized;
  }

  if (Object.keys(data).length === 0) return toClientSafeDto(client);

  const updated = await prisma.client.update({
    where: { id: clientId },
    data,
    select: CLIENT_SAFE_SELECT,
  });
  return toClientSafeDto(updated);
}

module.exports = { lookupClient, upsertClient, loadClientForActor, listClients, getClient, createClient, updateClient };
