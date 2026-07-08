const prisma = require('../utils/prisma');
const { encryptField, decryptField } = require('../utils/intakeCrypto');
const { BadRequestError } = require('../utils/errors');
const { loadClientForActor } = require('./clientService');

/**
 * Crea (o completa) la ficha de anamnesis dentro de la misma transacción
 * que crea/actualiza el Client y las Appointment — si el cifrado falla,
 * el rollback de Prisma cubre todo. Este es el camino del FLUJO PÚBLICO de
 * reserva: el actor es el propio cliente, solo cifra, nunca descifra, y NO
 * se audita (la auditoría es para accesos del panel de staff).
 */
async function upsertIntake(tx, tenantId, clientId, { allergies, conditions, consentSigned, consentSignedAt }) {
  const allergiesEncrypted = encryptField(allergies ?? null);
  const conditionsEncrypted = encryptField(conditions ?? null);

  return tx.clientIntake.upsert({
    where: { clientId },
    update: {
      allergiesEnc: allergiesEncrypted.enc,
      allergiesIv: allergiesEncrypted.iv,
      allergiesTag: allergiesEncrypted.tag,
      conditionsEnc: conditionsEncrypted.enc,
      conditionsIv: conditionsEncrypted.iv,
      conditionsTag: conditionsEncrypted.tag,
      consentSigned: !!consentSigned,
      consentSignedAt: consentSigned ? consentSignedAt ?? new Date() : null,
    },
    create: {
      tenantId,
      clientId,
      allergiesEnc: allergiesEncrypted.enc,
      allergiesIv: allergiesEncrypted.iv,
      allergiesTag: allergiesEncrypted.tag,
      conditionsEnc: conditionsEncrypted.enc,
      conditionsIv: conditionsEncrypted.iv,
      conditionsTag: conditionsEncrypted.tag,
      consentSigned: !!consentSigned,
      consentSignedAt: consentSigned ? consentSignedAt ?? new Date() : null,
    },
  });
}

/**
 * Lectura auditada de la anamnesis (panel de staff).
 * Orden fail-closed: cargar Client → validar scope → escribir auditoría →
 * SOLO entonces descifrar → armar DTO. Si el append de auditoría falla, se
 * propaga la excepción y nunca se llega a descifrar ni a devolver el dato.
 */
async function getIntakeForActor(actor, clientId) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;

  const intake = await prisma.clientIntake.findUnique({ where: { clientId } });
  if (!intake) return null; // no hay ficha: nada se divulga, nada que auditar

  // Auditoría ANTES de descifrar. createMany es una escritura atómica: si falla,
  // el throw impide llegar al descifrado de abajo.
  await prisma.clientIntakeAuditLog.createMany({
    data: [
      { tenantId: client.tenantId, clientId, actorId: actor.id, field: 'allergies', action: 'read' },
      { tenantId: client.tenantId, clientId, actorId: actor.id, field: 'conditions', action: 'read' },
    ],
  });

  // Recién ahora se descifra. Un error de descifrado (auth tag inválido = posible
  // manipulación en DB) se propaga como 500 — nunca se degrada silenciosamente a null.
  return {
    clientId,
    allergies: decryptField({ enc: intake.allergiesEnc, iv: intake.allergiesIv, tag: intake.allergiesTag }),
    conditions: decryptField({ enc: intake.conditionsEnc, iv: intake.conditionsIv, tag: intake.conditionsTag }),
    consentSigned: intake.consentSigned,
    consentSignedAt: intake.consentSignedAt,
  };
}

/**
 * Edición auditada de la anamnesis (panel de staff). Auditoría + re-cifrado van
 * en la misma transacción: rollback conjunto garantiza que nunca hay edición sin
 * registro. Solo se tocan los campos presentes en `changes` (no borra los demás).
 */
async function updateIntakeForActor(actor, clientId, changes) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;

  const fields = {};
  const auditRows = [];

  if (changes.allergies !== undefined) {
    const e = encryptField(changes.allergies ?? null);
    fields.allergiesEnc = e.enc;
    fields.allergiesIv = e.iv;
    fields.allergiesTag = e.tag;
    auditRows.push({ tenantId: client.tenantId, clientId, actorId: actor.id, field: 'allergies', action: 'update' });
  }
  if (changes.conditions !== undefined) {
    const e = encryptField(changes.conditions ?? null);
    fields.conditionsEnc = e.enc;
    fields.conditionsIv = e.iv;
    fields.conditionsTag = e.tag;
    auditRows.push({ tenantId: client.tenantId, clientId, actorId: actor.id, field: 'conditions', action: 'update' });
  }
  if (changes.consentSigned !== undefined) {
    fields.consentSigned = !!changes.consentSigned;
    fields.consentSignedAt = changes.consentSigned ? changes.consentSignedAt ?? new Date() : null;
    auditRows.push({ tenantId: client.tenantId, clientId, actorId: actor.id, field: 'consent', action: 'update' });
  }

  if (auditRows.length === 0) {
    throw new BadRequestError('No hay campos de anamnesis para actualizar (allergies, conditions, consentSigned)');
  }

  const saved = await prisma.$transaction(async (tx) => {
    await tx.clientIntakeAuditLog.createMany({ data: auditRows });
    return tx.clientIntake.upsert({
      where: { clientId },
      update: fields,
      create: { tenantId: client.tenantId, clientId, ...fields },
    });
  });

  // No se devuelven valores descifrados desde un update (evita una lectura
  // no auditada); solo metadata no sensible.
  return {
    clientId,
    consentSigned: saved.consentSigned,
    consentSignedAt: saved.consentSignedAt,
    updatedAt: saved.updatedAt,
  };
}

/**
 * Lee el log de auditoría de la ficha de un cliente. Solo metadatos (no descifra
 * nada), así que no se auto-audita. La ruta lo restringe a dueno/superadmin.
 */
async function getIntakeAuditLog(actor, clientId) {
  const client = await loadClientForActor(actor, clientId);
  if (!client) return null;

  return prisma.clientIntakeAuditLog.findMany({
    where: { tenantId: client.tenantId, clientId },
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = { upsertIntake, getIntakeForActor, updateIntakeForActor, getIntakeAuditLog };
