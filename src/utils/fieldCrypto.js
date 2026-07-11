const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

/**
 * Núcleo genérico de cifrado de campos AES-256-GCM. La lógica está auditada una
 * sola vez acá; cada dataset la consume con SU propia clave vía un wrapper delgado
 * (intakeCrypto = INTAKE_ENCRYPTION_KEY, whatsappCredentialCrypto =
 * WHATSAPP_TOKEN_ENCRYPTION_KEY). La clave se resuelve de forma LAZY dentro de
 * cada operación (no al construir la factory) — un test puede borrar la env var
 * a mitad y esperar que la siguiente operación lance.
 */
function getKeyBuffer(keyEnvName) {
  const raw = process.env[keyEnvName];
  if (!raw) {
    throw new Error(`${keyEnvName} no está configurada`);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(`${keyEnvName} debe decodificar a ${KEY_LENGTH} bytes (recibido: ${key.length})`);
  }
  return key;
}

function makeFieldCrypto(keyEnvName) {
  function encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined) {
      return { enc: null, iv: null, tag: null };
    }
    const key = getKeyBuffer(keyEnvName);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { enc, iv, tag };
  }

  function decrypt({ enc, iv, tag }) {
    if (!enc) {
      return null;
    }
    const key = getKeyBuffer(keyEnvName);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(enc), decipher.final()]);
    return plaintext.toString('utf8');
  }

  return { encrypt, decrypt };
}

/**
 * Fail-fast al arranque: valida que la clave nombrada exista y sea válida, o
 * detiene el proceso. Credenciales/datos sensibles no toleran fallar en caliente.
 */
function assertKeyOrExit(keyEnvName) {
  try {
    getKeyBuffer(keyEnvName);
  } catch (err) {
    console.error(`[FATAL] ${err.message}`);
    process.exit(1);
  }
}

module.exports = { makeFieldCrypto, assertKeyOrExit };
