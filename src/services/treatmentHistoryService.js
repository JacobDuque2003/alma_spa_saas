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
  });
  return records.map(toDTO);
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

module.exports = { listTreatments, createTreatment, updateTreatment, deleteTreatment };
