const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const { encryptField } = require('../utils/intakeCrypto');
const clientIntakeService = require('./clientIntakeService');

function encryptedIntake({ allergies, conditions }) {
  const a = encryptField(allergies);
  const c = encryptField(conditions);
  return {
    allergiesEnc: a.enc, allergiesIv: a.iv, allergiesTag: a.tag,
    conditionsEnc: c.enc, conditionsIv: c.iv, conditionsTag: c.tag,
    consentSigned: true, consentSignedAt: new Date(),
  };
}

test('getIntakeForActor: lectura exitosa audita ANTES y devuelve el DTO descifrado', async () => {
  let auditWritten = false;
  const auditCalls = [];
  prisma.client = { findUnique: async () => ({ id: 'c1', tenantId: 't1' }) };
  prisma.clientIntake = { findUnique: async () => encryptedIntake({ allergies: 'Penicilina', conditions: 'Hipertensión' }) };
  prisma.clientIntakeAuditLog = {
    createMany: async ({ data }) => { auditWritten = true; auditCalls.push(...data); return { count: data.length }; },
  };

  const dto = await clientIntakeService.getIntakeForActor({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1');
  assert.equal(auditWritten, true);
  assert.equal(dto.allergies, 'Penicilina');
  assert.equal(dto.conditions, 'Hipertensión');
  assert.equal('allergiesEnc' in dto, false); // nunca expone el ciphertext
  assert.deepEqual(auditCalls.map((r) => r.action), ['read', 'read']);
});

test('getIntakeForActor: FAIL-CLOSED — si la auditoría falla, NO se devuelve el dato descifrado', async () => {
  prisma.client = { findUnique: async () => ({ id: 'c1', tenantId: 't1' }) };
  prisma.clientIntake = { findUnique: async () => encryptedIntake({ allergies: 'Secreto', conditions: 'Secreto' }) };
  prisma.clientIntakeAuditLog = {
    createMany: async () => { throw new Error('fallo de auditoría'); },
  };

  await assert.rejects(
    () => clientIntakeService.getIntakeForActor({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1'),
    /fallo de auditoría/
  );
});

test('getIntakeForActor: cross-tenant lanza 403 y NO escribe fila de auditoría', async () => {
  let auditWritten = false;
  prisma.client = { findUnique: async () => ({ id: 'c1', tenantId: 'tenant-ajeno' }) };
  prisma.clientIntakeAuditLog = { createMany: async () => { auditWritten = true; return {}; } };

  await assert.rejects(
    () => clientIntakeService.getIntakeForActor({ id: 'u1', tenantId: 'tenant-propio', role: 'personal' }, 'c1'),
    (err) => err.status === 403
  );
  assert.equal(auditWritten, false);
});

test('updateIntakeForActor: audita solo los campos cambiados dentro de la transacción', async () => {
  const auditCalls = [];
  prisma.client = { findUnique: async () => ({ id: 'c1', tenantId: 't1' }) };
  prisma.$transaction = async (cb) => cb({
    clientIntakeAuditLog: { createMany: async ({ data }) => { auditCalls.push(...data); } },
    clientIntake: { upsert: async () => ({ consentSigned: true, consentSignedAt: new Date(), updatedAt: new Date() }) },
  });

  await clientIntakeService.updateIntakeForActor({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', { allergies: 'Nueva alergia' });
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].field, 'allergies');
  assert.equal(auditCalls[0].action, 'update');
});

test('updateIntakeForActor: rechaza con 400 si no hay campos de anamnesis para actualizar', async () => {
  prisma.client = { findUnique: async () => ({ id: 'c1', tenantId: 't1' }) };
  await assert.rejects(
    () => clientIntakeService.updateIntakeForActor({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', { nombre: 'x' }),
    (err) => err.status === 400
  );
});
