const prisma = require('../utils/prisma');
const { assertTenantScope } = require('../utils/tenantScope');
const { normalizePhone } = require('../utils/phone');

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
  if (!tenantId) throw new (require('../errors').BadRequestError)('tenantId es requerido');
  if (!data.fullName || !data.whatsapp) {
    throw new (require('../errors').BadRequestError)('fullName y whatsapp son requeridos');
  }
  const whatsapp = normalizePhone(data.whatsapp);
  const client = await prisma.client.create({
    data: { tenantId, fullName: data.fullName, whatsapp, email: data.email || null },
    select: CLIENT_SAFE_SELECT,
  });
  return toClientSafeDto(client);
}

module.exports = { lookupClient, upsertClient, loadClientForActor, listClients, getClient, createClient };
