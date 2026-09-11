const { Prisma } = require('@prisma/client');
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
  recordNumber: true,
  fullName: true,
  whatsapp: true,
  email: true,
  address: true,
  cedula: true,
  birthday: true,
  birthdayYearKnown: true,
  active: true,
  createdAt: true,
  updatedAt: true,
};


function toClientSafeDto(client) {
  if (!client) return client;
  return {
    id: client.id,
    tenantId: client.tenantId,
    recordNumber: client.recordNumber,
    fullName: client.fullName,
    whatsapp: client.whatsapp,
    email: client.email,
    address: client.address,
    cedula: client.cedula,
    birthday: client.birthday ? toISODate(client.birthday) : null,
    birthdayYearKnown: client.birthdayYearKnown !== false,
    age: client.birthday && client.birthdayYearKnown !== false ? computeAge(new Date(client.birthday), new Date()) : null,
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

function computeAge(birthday, today) {
  let age = today.getUTCFullYear() - birthday.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birthday.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birthday.getUTCDate())) age -= 1;
  return Math.max(age, 0);
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

function buildClientListWhere(actor, query = {}) {
  const activeQuery = String(query.active ?? 'true').toLowerCase();
  const where = {};
  if (activeQuery === 'false') where.active = false;
  if (activeQuery === 'true') where.active = true;
  if (actor.role === 'superadmin') {
    if (query.tenantId) where.tenantId = query.tenantId;
  } else {
    where.tenantId = actor.tenantId;
  }

  if (query.q) {
    const q = String(query.q).trim();
    if (q) {
      const or = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { recordNumber: { contains: q, mode: 'insensitive' } },
        { whatsapp: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
        { cedula: { contains: q } },
      ];
      // Búsqueda de teléfono tolerante al formato local: si el input es
      // numérico (con o sin +), buscamos también por los últimos dígitos.
      // Así "0993629256" (formato Ecuador) encuentra "+593993629256" en DB.
      const digits = q.replace(/[^0-9]/g, '');
      if (digits.length >= 7) {
        or.push({ whatsapp: { endsWith: digits.replace(/^0+/, '') } });
      }
      where.OR = or;
    }
  }

  return where;
}

function buildClientListWhereSql(actor, query = {}) {
  const where = buildClientListWhere(actor, query);
  const clauses = [];
  if (where.tenantId) clauses.push(Prisma.sql`"tenantId" = ${where.tenantId}`);
  if (where.active === true || where.active === false) clauses.push(Prisma.sql`"active" = ${where.active}`);

  const q = String(query.q || '').trim();
  if (q) {
    const contains = `%${q}%`;
    const phoneDigits = q.replace(/[^0-9]/g, '').replace(/^0+/, '');
    const searchClauses = [
      Prisma.sql`"fullName" ILIKE ${contains}`,
      Prisma.sql`"recordNumber" ILIKE ${contains}`,
      Prisma.sql`"whatsapp" LIKE ${contains}`,
      Prisma.sql`"email" ILIKE ${contains}`,
      Prisma.sql`"cedula" LIKE ${contains}`,
    ];
    if (phoneDigits.length >= 7) {
      searchClauses.push(Prisma.sql`"whatsapp" LIKE ${`%${phoneDigits}`}`);
    }
    clauses.push(Prisma.sql`(${Prisma.join(searchClauses, ' OR ')})`);
  }

  return clauses.length ? Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}` : Prisma.empty;
}

async function listClientsByRecordNumber(actor, query, { limit, offset, sortDirection, withTotal }) {
  const where = buildClientListWhere(actor, query);
  const whereSql = buildClientListWhereSql(actor, query);
  const q = String(query.q || '').trim();
  const direction = sortDirection === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const emptyDirection = sortDirection === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const searchPriority = q
    ? Prisma.sql`
        CASE
          WHEN "recordNumber" = ${q} THEN 0
          WHEN "recordNumber" ILIKE ${`${q}%`} THEN 1
          WHEN "recordNumber" ILIKE ${`%${q}%`} THEN 2
          ELSE 3
        END ASC,
      `
    : Prisma.empty;

  const [clients, total] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        "id", "tenantId", "recordNumber", "fullName", "whatsapp", "email",
        "address", "cedula", "birthday", "birthdayYearKnown", "active",
        "createdAt", "updatedAt"
      FROM "Client"
      ${whereSql}
      ORDER BY
        ${searchPriority}
        CASE WHEN "recordNumber" IS NULL OR btrim("recordNumber") = '' THEN 0 ELSE 1 END ${emptyDirection},
        NULLIF(regexp_replace("recordNumber", '[^0-9]', '', 'g'), '')::numeric ${direction} NULLS LAST,
        "recordNumber" ${direction} NULLS LAST,
        "fullName" ASC,
        "createdAt" DESC,
        "id" ASC
      OFFSET ${offset}
      LIMIT ${limit}
    `,
    withTotal ? prisma.client.count({ where }) : Promise.resolve(null),
  ]);

  const rows = clients.map(toClientSafeDto);
  if (withTotal) {
    return {
      rows,
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
  }
  return rows;
}

async function listClients(actor, query = {}) {
  const where = buildClientListWhere(actor, query);
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 1000);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const withTotal = String(query.total ?? query.withTotal ?? '').toLowerCase() === 'true';
  const sortDirection = String(query.sortDirection || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  const sortKey = String(query.sortKey || 'fullName');
  const orderField = ['recordNumber', 'fullName', 'whatsapp', 'email', 'birthday', 'active', 'createdAt'].includes(sortKey)
    ? sortKey
    : 'fullName';

  if (orderField === 'recordNumber' && typeof prisma.$queryRaw === 'function') {
    return listClientsByRecordNumber(actor, query, { limit, offset, sortDirection, withTotal });
  }

  const orderBy = [{ [orderField]: sortDirection }];
  if (orderField !== 'fullName') orderBy.push({ fullName: 'asc' });
  if (orderField !== 'createdAt') orderBy.push({ createdAt: 'desc' });
  orderBy.push({ id: 'asc' });

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      select: CLIENT_SAFE_SELECT,
      orderBy,
      skip: offset,
      take: limit,
    }),
    withTotal ? prisma.client.count({ where }) : Promise.resolve(null),
  ]);
  const rows = clients.map(toClientSafeDto);
  if (withTotal) {
    return {
      rows,
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    };
  }
  return rows;
}

async function exportClients(actor, query = {}) {
  const where = {};
  if (actor.role === 'superadmin') {
    if (query.tenantId) where.tenantId = query.tenantId;
  } else {
    where.tenantId = actor.tenantId;
  }

  const clients = await prisma.client.findMany({
    where,
    select: CLIENT_SAFE_SELECT,
    orderBy: [{ fullName: 'asc' }, { createdAt: 'desc' }],
  });
  return clients.map(toClientSafeDto);
}

async function searchClients(actor, query = {}) {
  const q = String(query.q || '').trim();
  if (!q) return [];

  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 10);
  const clients = await listClients(actor, {
    ...query,
    active: 'true',
    q,
    limit,
    offset: 0,
    sortKey: 'recordNumber',
    sortDirection: 'asc',
  });

  return clients.map((c) => ({
    type: 'client',
    id: c.id,
    name: c.fullName,
    recordNumber: c.recordNumber,
    phone: c.whatsapp,
  }));
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
  // M-2: no exponer clientId en respuesta pública — el server hace upsert por
  // tenantId_whatsapp más adelante, así que el flujo público no lo necesita.
  return { exists: true, requiresIntake };
}

/**
 * Upsert dentro de una transacción (el caller decide el tx) — el cliente
 * se crea o actualiza como parte de la misma operación atómica que crea
 * su ClientIntake y sus Appointment.
 */
async function nextAvailableRecordNumber(tx, tenantId) {
  // Las fichas son el identificador visible y único de la clienta. Partimos
  // del primer hueco libre, no del último número usado, para recuperar las
  // fichas históricas que quedaron disponibles. La restricción única de
  // base de datos sigue siendo la autoridad final ante dos altas simultáneas.
  if (typeof tx?.client?.findMany !== 'function') return null;
  const rows = await tx.client.findMany({
    where: { tenantId, recordNumber: { not: null } },
    select: { recordNumber: true },
    orderBy: { recordNumber: 'asc' },
  });
  const occupied = new Set(rows
    .map((row) => String(row.recordNumber || '').trim())
    .filter((value) => /^\d+$/.test(value))
    .map(Number));
  let candidate = 1;
  while (occupied.has(candidate)) candidate += 1;
  return String(candidate);
}

// Vista previa para el formulario de alta. La ficha definitiva se vuelve a
// calcular al guardar: así dos personas que abran el formulario al mismo
// tiempo nunca terminan compartiendo un número.
async function getNextAvailableRecordNumber(actor) {
  const tenantId = actor?.tenantId;
  if (!tenantId) throw new BadRequestError('tenantId es requerido');
  return nextAvailableRecordNumber(prisma, tenantId);
}

async function upsertClient(tx, tenantId, { fullName, whatsapp, email, address, cedula }) {
  const normalized = normalizePhone(whatsapp);
  const recordNumber = await nextAvailableRecordNumber(tx, tenantId);
  return tx.client.upsert({
    where: { tenantId_whatsapp: { tenantId, whatsapp: normalized } },
    update: { fullName, email, ...(address !== undefined ? { address } : {}), ...(cedula !== undefined ? { cedula } : {}) },
    create: { tenantId, ...(recordNumber ? { recordNumber } : {}), fullName, whatsapp: normalized, email, ...(address !== undefined ? { address } : {}), ...(cedula !== undefined ? { cedula } : {}) },
  });
}

async function createClient(actor, data) {
  const tenantId = actor.role === 'superadmin' ? (data.tenantId || actor.tenantId) : actor.tenantId;
  if (!tenantId) throw new BadRequestError('tenantId es requerido');
  if (!data.fullName) {
    throw new BadRequestError('fullName es requerido');
  }
  const hasWhatsapp = !!String(data.whatsapp || '').trim();
  const whatsapp = hasWhatsapp ? normalizePhone(data.whatsapp) : null;
  if (hasWhatsapp && !isValidE164(whatsapp)) {
    throw new BadRequestError('Formato de WhatsApp inválido. Use formato E.164 (ej: +593999000001)');
  }
  if (data.email && !isValidEmail(data.email)) {
    throw new BadRequestError('Formato de email inválido');
  }
  const birthday = data.birthday !== undefined ? parseBirthdayOrThrow(data.birthday) : null;
  let client;
  try {
    const automaticRecordNumber = data.recordNumber ? null : await nextAvailableRecordNumber(prisma, tenantId);
    client = await prisma.client.create({
      data: {
        tenantId,
        recordNumber: data.recordNumber ? String(data.recordNumber).trim() : automaticRecordNumber,
        fullName: String(data.fullName).trim(),
        whatsapp,
        email: data.email ? String(data.email).trim().toLowerCase() : null,
        address: data.address ? String(data.address).trim() : null,
        cedula: data.cedula ? String(data.cedula).trim() : null,
        birthday,
        birthdayYearKnown: birthday ? true : undefined,
      },
      select: CLIENT_SAFE_SELECT,
    });
  } catch (err) {
    // P2002: unique constraint (tenantId, whatsapp). Reportamos con
    // nombre del cliente existente para que el usuario sepa contra quién
    // colisiona en vez de un "ya existe" opaco.
    if (err && err.code === 'P2002') {
      const existing = whatsapp ? await prisma.client.findUnique({
        where: { tenantId_whatsapp: { tenantId, whatsapp } }, select: { fullName: true },
      }) : null;
      const name = existing?.fullName || 'otra clienta';
      throw new BadRequestError(`Ya existe una clienta con este WhatsApp: ${name}`);
    }
    throw err;
  }
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
  if (changes.recordNumber !== undefined) {
    if (!changes.recordNumber) throw new BadRequestError('La ficha no se puede dejar vacía');
    data.recordNumber = String(changes.recordNumber).trim();
  }
  if (changes.address !== undefined) {
    data.address = changes.address ? String(changes.address).trim() : null;
  }
  if (changes.cedula !== undefined) {
    data.cedula = changes.cedula ? String(changes.cedula).trim() : null;
  }
  if (changes.whatsapp !== undefined) {
    if (!String(changes.whatsapp || '').trim()) {
      data.whatsapp = null;
    } else {
      const normalized = normalizePhone(changes.whatsapp);
      if (!isValidE164(normalized)) {
        throw new BadRequestError('Formato de WhatsApp inválido. Use formato E.164 (ej: +593999000001)');
      }
      data.whatsapp = normalized;
    }
  }
  if (changes.birthday !== undefined) {
    data.birthday = parseBirthdayOrThrow(changes.birthday);
    data.birthdayYearKnown = data.birthday ? true : false;
  }

  if (Object.keys(data).length === 0) return toClientSafeDto(client);

  const updated = await prisma.client.update({
    where: { id: clientId },
    data,
    select: CLIENT_SAFE_SELECT,
  });
  return toClientSafeDto(updated);
}

async function setClientActive(actor, clientId, active) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;

  const updated = await prisma.client.update({
    where: { id: clientId },
    data: { active },
    select: CLIENT_SAFE_SELECT,
  });
  return toClientSafeDto(updated);
}

async function deleteClient(actor, clientId) {
  return setClientActive(actor, clientId, false);
}

async function enableClient(actor, clientId) {
  return setClientActive(actor, clientId, true);
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

// Devuelve un Date cuyas componentes UTC (getUTCFullYear/Month/Date) coinciden
// con la fecha calendario LOCAL en la timezone `tz`. Necesario porque después
// de las 19:00 en Ecuador (UTC-5) `new Date().getUTCDate()` ya está en el día
// siguiente. Usar Intl para pedirle al motor la fecha en la zona correcta
// evita implementar TZ math a mano.
function todayInTimezone(now, tz) {
  // en-CA da formato YYYY-MM-DD estable
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year').value);
  const m = Number(parts.find((p) => p.type === 'month').value);
  const d = Number(parts.find((p) => p.type === 'day').value);
  return new Date(Date.UTC(y, m - 1, d));
}

const DEFAULT_TZ = 'America/Guayaquil';

async function listUpcomingBirthdays(actor, days = 7) {
  if (!actor.tenantId) throw new BadRequestError('tenantId es requerido');
  const window = Math.min(Math.max(Number(days) || 7, 1), 366);

  const [tenant, rows] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: actor.tenantId }, select: { config: true } }),
    prisma.client.findMany({
      where: { tenantId: actor.tenantId, active: true, birthday: { not: null } },
      select: { id: true, recordNumber: true, fullName: true, whatsapp: true, birthday: true, birthdayYearKnown: true },
    }),
  ]);

  // La timezone del tenant es data confiable (viene de la config administrada
  // por el dueño, nunca del payload del request); si no está, cae al default
  // del producto (Ecuador). No aceptamos override por query — evita bypass.
  const tz = tenant?.config?.timezone || DEFAULT_TZ;
  const today = todayInTimezone(new Date(), tz);
  return rows
    .map((c) => ({
      id: c.id,
      recordNumber: c.recordNumber,
      fullName: c.fullName,
      whatsapp: c.whatsapp,
      birthday: toISODate(c.birthday),
      birthdayYearKnown: c.birthdayYearKnown !== false,
      daysUntil: computeDaysUntilBirthday(new Date(c.birthday), today),
    }))
    .filter((r) => r.daysUntil <= window)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

module.exports = { lookupClient, upsertClient, loadClientForActor, listClients, exportClients, searchClients, getClient, createClient, getNextAvailableRecordNumber, updateClient, deleteClient, enableClient, listUpcomingBirthdays, computeDaysUntilBirthday, todayInTimezone };
