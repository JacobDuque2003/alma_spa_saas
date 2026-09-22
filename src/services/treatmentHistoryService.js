const prisma = require('../utils/prisma');
const { encryptField, decryptField } = require('../utils/intakeCrypto');
const { assertTenantScope } = require('../utils/tenantScope');
const { BadRequestError } = require('../utils/errors');
const { loadClientForActor } = require('./clientService');

const STAFF_ROLES = ['personal', 'dueno'];

function toDTO(record) {
  const { notesEnc, notesIv, notesTag, ...rest } = record;
  return {
    ...rest,
    notes: decryptField({ enc: notesEnc, iv: notesIv, tag: notesTag }),
  };
}

/**
 * Resuelve el terapeuta acreditado: por defecto el actor logueado, pero
 * seleccionable (recepción carga en nombre del terapeuta que atendió).
 * Siempre validado: debe ser staff del tenant, activo y habilitado para
 * atender citas (canAttendAppointments).
 */
async function resolveTherapist(tenantId, actor, therapistId) {
  const targetId = therapistId ?? actor.id;
  const therapist = await prisma.user.findFirst({
    where: { id: targetId, tenantId, role: { in: STAFF_ROLES }, active: true, canAttendAppointments: true },
  });
  if (!therapist) {
    throw new BadRequestError('therapistId inválido: debe ser staff habilitado para atender citas en este tenant');
  }
  return therapist.id;
}

async function listTreatments(actor, clientId) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;

  const records = await prisma.treatmentHistory.findMany({
    where: { tenantId: client.tenantId, clientId },
    orderBy: { sessionDate: 'desc' },
    include: {
      service: { select: { id: true, name: true } },
      therapist: { select: { id: true, name: true } },
    },
  });
  return records.map(toDTO);
}

function historyDateRange(query = {}) {
  const range = {};
  if (query.from) {
    const from = new Date(`${query.from}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime())) throw new BadRequestError('Fecha inicial invalida');
    range.gte = from;
  }
  if (query.to) {
    const to = new Date(`${query.to}T00:00:00.000Z`);
    if (Number.isNaN(to.getTime())) throw new BadRequestError('Fecha final invalida');
    to.setUTCDate(to.getUTCDate() + 1);
    range.lt = to;
  }
  if (range.gte && range.lt && range.gte >= range.lt) {
    throw new BadRequestError('El rango de fechas es invalido');
  }
  return Object.keys(range).length ? range : undefined;
}

async function listClientHistory(actor, clientId, query = {}) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;

  const limit = Math.min(Math.max(Number(query.limit) || 15, 1), 50);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const filter = ['all', 'appointments', 'treatments', 'exceptions'].includes(String(query.filter))
    ? String(query.filter)
    : 'all';
  const dateRange = historyDateRange(query);
  const includeAppointments = filter !== 'treatments';
  const includeTreatments = filter !== 'appointments' && filter !== 'exceptions';
  const appointmentWhere = {
    tenantId: client.tenantId,
    clientId,
    ...(dateRange ? { startsAt: dateRange } : {}),
    ...(filter === 'exceptions' ? { status: { in: ['cancelado', 'no_show'] } } : {}),
  };
  const treatmentWhere = {
    tenantId: client.tenantId,
    clientId,
    ...(dateRange ? { sessionDate: dateRange } : {}),
  };
  const fetchSize = offset + limit + 1;
  const appointmentInclude = {
    service: { select: { id: true, name: true, colorHex: true } },
    room: { select: { id: true, name: true } },
    staff: { select: { id: true, name: true } },
  };

  const [appointments, treatments, appointmentTotal, treatmentTotal] = await Promise.all([
    includeAppointments
      ? prisma.appointment.findMany({
        where: appointmentWhere,
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        take: fetchSize,
        include: appointmentInclude,
      })
      : Promise.resolve([]),
    includeTreatments
      ? prisma.treatmentHistory.findMany({
        where: treatmentWhere,
        orderBy: [{ sessionDate: 'desc' }, { id: 'desc' }],
        take: fetchSize,
        include: {
          service: { select: { id: true, name: true, colorHex: true } },
          therapist: { select: { id: true, name: true } },
        },
      })
      : Promise.resolve([]),
    includeAppointments ? prisma.appointment.count({ where: appointmentWhere }) : Promise.resolve(0),
    includeTreatments ? prisma.treatmentHistory.count({ where: treatmentWhere }) : Promise.resolve(0),
  ]);

  const rows = [
    ...appointments.map((appointment) => ({
      type: 'appointment',
      id: appointment.id,
      date: appointment.startsAt,
      appointment,
    })),
    ...treatments.map((record) => ({
      type: 'treatment',
      id: record.id,
      date: record.sessionDate,
      treatment: toDTO(record),
    })),
  ]
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.id.localeCompare(a.id))
    .slice(offset, offset + limit);
  const total = appointmentTotal + treatmentTotal;
  let appointmentSummary;
  if (String(query.includeSummary).toLowerCase() === 'true') {
    const now = new Date();
    const baseWhere = {
      tenantId: client.tenantId,
      clientId,
      status: { not: 'cancelado' },
    };
    const [nextAppointment, lastAppointment] = await Promise.all([
      prisma.appointment.findFirst({
        where: { ...baseWhere, startsAt: { gte: now } },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        include: appointmentInclude,
      }),
      prisma.appointment.findFirst({
        where: { ...baseWhere, startsAt: { lt: now } },
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        include: appointmentInclude,
      }),
    ]);
    appointmentSummary = { nextAppointment, lastAppointment };
  }

  return {
    rows,
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
    ...(appointmentSummary ? { appointmentSummary } : {}),
  };
}

async function listAvailableTherapists(actor) {
  if (!actor?.tenantId) return [];
  return prisma.user.findMany({
    where: {
      tenantId: actor.tenantId,
      role: { in: STAFF_ROLES },
      active: true,
      canAttendAppointments: true,
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

async function createTreatment(actor, clientId, data) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;

  if (!data.serviceId || !data.sessionDate) {
    throw new BadRequestError('serviceId y sessionDate son requeridos');
  }

  const service = await prisma.service.findFirst({
    where: { id: data.serviceId, tenantId: client.tenantId, active: true },
  });
  if (!service) {
    throw new BadRequestError('serviceId inválido para este tenant');
  }

  const therapistId = await resolveTherapist(client.tenantId, actor, data.therapistId);

  if (data.appointmentId) {
    const appointment = await prisma.appointment.findFirst({
      where: { id: data.appointmentId, tenantId: client.tenantId, clientId },
    });
    if (!appointment) {
      throw new BadRequestError('appointmentId inválido: no pertenece a este cliente/tenant');
    }
  }

  const notes = encryptField(data.notes ?? null);

  const record = await prisma.treatmentHistory.create({
    data: {
      tenantId: client.tenantId,
      clientId,
      serviceId: data.serviceId,
      therapistId,
      createdById: actor.id,
      appointmentId: data.appointmentId ?? null,
      sessionDate: new Date(data.sessionDate),
      notesEnc: notes.enc,
      notesIv: notes.iv,
      notesTag: notes.tag,
      productsUsed: Array.isArray(data.productsUsed) ? data.productsUsed : [],
      photoBeforeUrl: data.photoBeforeUrl ?? null,
      photoAfterUrl: data.photoAfterUrl ?? null,
    },
  });
  return toDTO(record);
}

async function updateTreatment(actor, id, changes) {
  const target = await prisma.treatmentHistory.findUnique({ where: { id } });
  if (!target) return null;
  assertTenantScope(actor, target.tenantId);

  const data = { updatedById: actor.id }; // D8: atribución de la última edición

  if (changes.sessionDate !== undefined) data.sessionDate = new Date(changes.sessionDate);
  if (changes.productsUsed !== undefined) {
    data.productsUsed = Array.isArray(changes.productsUsed) ? changes.productsUsed : [];
  }
  if (changes.photoBeforeUrl !== undefined) data.photoBeforeUrl = changes.photoBeforeUrl;
  if (changes.photoAfterUrl !== undefined) data.photoAfterUrl = changes.photoAfterUrl;
  if (changes.notes !== undefined) {
    const notes = encryptField(changes.notes ?? null);
    data.notesEnc = notes.enc;
    data.notesIv = notes.iv;
    data.notesTag = notes.tag;
  }
  if (changes.therapistId !== undefined) {
    data.therapistId = await resolveTherapist(target.tenantId, actor, changes.therapistId);
  }

  const record = await prisma.treatmentHistory.update({ where: { id }, data });
  return toDTO(record);
}

async function deleteTreatment(actor, id) {
  const target = await prisma.treatmentHistory.findUnique({ where: { id } });
  if (!target) return null;
  assertTenantScope(actor, target.tenantId);

  await prisma.treatmentHistory.delete({ where: { id } });
  return { id };
}

module.exports = { listTreatments, listClientHistory, listAvailableTherapists, createTreatment, updateTreatment, deleteTreatment };
