const { makeFieldCrypto, assertKeyOrExit } = require('./fieldCrypto');

/**
 * Wrapper para credenciales de WhatsApp (accessToken, appSecret) con la clave
 * dedicada WHATSAPP_TOKEN_ENCRYPTION_KEY.
 *
 * Los verbos publicados (sealWhatsappSecret / openWhatsappSecret) son
 * deliberadamente distintos a los del wrapper de intake: dan a WhatsApp su
 * propio guard con su propia allowlist (whatsappConnectionService.js para
 * seal, whatsappTransport.js para open). Compartimentación en la capa de
 * code-review espeja la compartimentación en la capa de claves.
 */
const { encrypt, decrypt } = makeFieldCrypto('WHATSAPP_TOKEN_ENCRYPTION_KEY');

module.exports = {
  sealWhatsappSecret: encrypt,
  openWhatsappSecret: decrypt,
  assertWhatsappKeyOrExit: () => assertKeyOrExit('WHATSAPP_TOKEN_ENCRYPTION_KEY'),
};
