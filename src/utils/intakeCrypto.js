const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function getKeyBuffer() {
  const raw = process.env.INTAKE_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('INTAKE_ENCRYPTION_KEY no está configurada');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(`INTAKE_ENCRYPTION_KEY debe decodificar a ${KEY_LENGTH} bytes (recibido: ${key.length})`);
  }
  return key;
}

/**
 * Valida INTAKE_ENCRYPTION_KEY al arrancar. Datos de salud no toleran
 * "arrancar y fallar en el primer request" — se detiene el proceso ya.
 */
function assertEncryptionKeyOrExit() {
  try {
    getKeyBuffer();
  } catch (err) {
    console.error(`[FATAL] ${err.message}`);
    process.exit(1);
  }
}

function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined) {
    return { enc: null, iv: null, tag: null };
  }
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc, iv, tag };
}

function decryptField({ enc, iv, tag }) {
  if (!enc) {
    return null;
  }
  const key = getKeyBuffer();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(enc), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encryptField, decryptField, assertEncryptionKeyOrExit };
