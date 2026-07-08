const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const treatmentHistoryService = require('./treatmentHistoryService');

const clientOk = () => ({ findUnique: async () => ({ id: 'c1', tenantId: 't1' }) });

test('createTreatment: terapeuta por defecto = actor; notas cifradas roundtrip', async () => {
  prisma.client = clientOk();
  prisma.service = { findFirst: async () => ({ id: 'srv1', tenantId: 't1', active: true }) };
  prisma.user = { findFirst: async () => ({ id: 'tera1' }) }; // therapist válido (canAttendAppointments)
  prisma.treatmentHistory = { create: async ({ data }) => ({ id: 'th1', ...data }) };

  const dto = await treatmentHistoryService.createTreatment(
    { id: 'tera1', tenantId: 't1', role: 'personal' },
    'c1',
    { serviceId: 'srv1', sessionDate: '2026-08-20T15:00:00.000Z', notes: 'Dolor lumbar reportado' }
  );

  assert.equal(dto.therapistId, 'tera1');
  assert.equal(dto.createdById, 'tera1');
  assert.equal(dto.notes, 'Dolor lumbar reportado'); // descifrado correcto
  assert.equal('notesEnc' in dto, false); // nunca expone ciphertext
});

test('createTreatment: terapeuta seleccionable (recepción carga en nombre del terapeuta)', async () => {
  prisma.client = clientOk();
  prisma.service = { findFirst: async () => ({ id: 'srv1', tenantId: 't1', active: true }) };
  let queried = null;
  prisma.user = { findFirst: async (args) => { queried = args.where; return { id: 'tera1' }; } };
  prisma.treatmentHistory = { create: async ({ data }) => ({ id: 'th1', ...data }) };

  const dto = await treatmentHistoryService.createTreatment(
    { id: 'recepcion1', tenantId: 't1', role: 'personal' },
    'c1',
    { serviceId: 'srv1', sessionDate: '2026-08-20T15:00:00.000Z', therapistId: 'tera1' }
  );

  assert.equal(dto.therapistId, 'tera1'); // terapeuta acreditado
  assert.equal(dto.createdById, 'recepcion1'); // quién lo cargó
  assert.equal(queried.canAttendAppointments, true); // validado como terapeuta real
});

test('createTreatment: rechaza con 400 si el therapistId no es terapeuta habilitado', async () => {
  prisma.client = clientOk();
  prisma.service = { findFirst: async () => ({ id: 'srv1', tenantId: 't1', active: true }) };
  prisma.user = { findFirst: async () => null }; // no cumple role/canAttendAppointments

  await assert.rejects(
    () => treatmentHistoryService.createTreatment(
      { id: 'recepcion1', tenantId: 't1', role: 'personal' },
      'c1',
      { serviceId: 'srv1', sessionDate: '2026-08-20T15:00:00.000Z', therapistId: 'recepcion1' }
    ),
    (err) => err.status === 400
  );
});

test('updateTreatment: setea updatedById = actor (D8)', async () => {
  let captured = null;
  prisma.treatmentHistory = {
    findUnique: async () => ({ id: 'th1', tenantId: 't1' }),
    update: async ({ data }) => { captured = data; return { id: 'th1', ...data }; },
  };

  await treatmentHistoryService.updateTreatment(
    { id: 'editor1', tenantId: 't1', role: 'dueno' },
    'th1',
    { notes: 'Corrección' }
  );
  assert.equal(captured.updatedById, 'editor1');
});
