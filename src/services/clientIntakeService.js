const { encryptField } = require('../utils/intakeCrypto');

/**
 * Crea (o completa) la ficha de anamnesis dentro de la misma transacción
 * que crea/actualiza el Client y las Appointment — si el cifrado falla,
 * el rollback de Prisma cubre todo. Solo create/upsert: no hay lectura ni
 * edición de ClientIntake en esta fase (queda para Fase 4).
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

module.exports = { upsertIntake };
