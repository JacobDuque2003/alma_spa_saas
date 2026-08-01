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
  birthday: true,
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
    birthday: client.birthday ? toISODate(client.birthday) : null,
    active: client.active,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

// @db.Date returns midnight UTC. We echo back a plain YYYY-MM-DD so the
// frontend's <input type="date"> gets a clean value without timezone drift.
function toISODate(d) {
  const dt = new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Parse "YYYY-MM-DD" into a Date at UTC midnight, so Prisma writes @db.Date
// with the exact day the user picked (no local-timezone drift).
const YYYY_MM_DD_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseBirthdayOrThrow(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !YYYY_MM_DD_RE.test(value)) {
    throw new BadRequestError('Formato de cumpleaños inválido. Usa YYYY-MM-DD');
  }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Reject calendar-invalid dates like 2026-02-30 which Date silently rolls over.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new BadRequestError('Fecha de cumpleaños inválida');
  }
  return dt;
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
  const birthday = data.birthday !== undefined ? parseBirthdayOrThrow(data.birthday) : null;
  const client = await prisma.client.create({
    data: {
      tenantId,
      fullName: String(data.fullName).trim(),
      whatsapp,
      email: data.email ? String(data.email).trim().toLowerCase() : null,
      birthday,
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
  if (changes.birthday !== undefined) {
    data.birthday = parseBirthdayOrThrow(changes.birthday);
  }

  if (Object.keys(data).length === 0) return toClientSafeDto(client);

  const updated = await prisma.client.update({
    where: { id: clientId },
    data,
    select: CLIENT_SAFE_SELECT,
  });
  return toClientSafeDto(updated);
}

/**
 * Devuelve clientes activos con cumpleaños en los próximos `days` días,
 * ordenados por proximidad. La comparación mes/día se hace en UTC porque
 * `@db.Date` guarda la fecha como medianoche UTC; usar horas locales
 * (Ecuador es UTC-5) daría off-by-one alrededor de medianoche.
 * Cubre el año-wraparound: 31-dic → 1-ene devuelve daysUntil = 1, no -364.
 */
// Extracted for testability. `today` and `birthday` are both Date objects; only
// the UTC month/day are read. Anchoring to year 2000 (leap) keeps Feb 29
// working. If the birthday's month/day is before today's, we roll to next year
// so 31-dec → 1-ene gives 1, not -364.
function computeDaysUntilBirthday(birthday, today) {
  const anchor = Date.UTC(2000, today.getUTCMonth(), today.getUTCDate());
  let target = Date.UTC(2000, birthday.getUTCMonth(), birthday.getUTCDate());
  if (target < anchor) target = Date.UTC(2001, birthday.getUTCMonth(), birthday.getUTCDate());
  return Math.round((target - anchor) / 86_400_000);
}

async function listUpcomingBirthdays(actor, days = 7) {
  if (!actor.tenantId) throw new BadRequestError('tenantId es requerido');
  const window = Math.min(Math.max(Number(days) || 7, 1), 366);

  const rows = await prisma.client.findMany({
    where: { tenantId: actor.tenantId, active: true, birthday: { not: null } },
    select: { id: true, fullName: true, whatsapp: true, birthday: true },
  });

  const today = new Date();
  return rows
    .map((c) => ({
      id: c.id,
      fullName: c.fullName,
      whatsapp: c.whatsapp,
      birthday: toISODate(c.birthday),
      daysUntil: computeDaysUntilBirthday(new Date(c.birthday), today),
    }))
    .filter((r) => r.daysUntil <= window)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

module.exports = { lookupClient, upsertClient, loadClientForActor, listClients, getClient, createClient, updateClient, listUpcomingBirthdays, computeDaysUntilBirthday };
