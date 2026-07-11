const { makeFieldCrypto, assertKeyOrExit } = require('./fieldCrypto');

/**
 * Wrapper delgado sobre fieldCrypto con INTAKE_ENCRYPTION_KEY. La superficie
 * pública se mantiene IDÉNTICA a la de Fase 3a (encryptField/decryptField/
 * assertEncryptionKeyOrExit) para no romper ningún consumidor existente
 * (clientIntakeService, treatmentHistoryService) ni el guard H1.
 */
const { encrypt, decrypt } = makeFieldCrypto('INTAKE_ENCRYPTION_KEY');

module.exports = {
  encryptField: encrypt,
  decryptField: decrypt,
  assertEncryptionKeyOrExit: () => assertKeyOrExit('INTAKE_ENCRYPTION_KEY'),
};
