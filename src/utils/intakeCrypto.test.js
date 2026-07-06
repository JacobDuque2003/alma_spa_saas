const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.INTAKE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
const { encryptField, decryptField } = require('./intakeCrypto');

test('encryptField/decryptField hacen roundtrip correcto', () => {
  const plaintext = 'alergia a la penicilina';
  const encrypted = encryptField(plaintext);
  assert.ok(Buffer.isBuffer(encrypted.enc));
  assert.equal(encrypted.iv.length, 12);
  assert.equal(encrypted.tag.length, 16);

  const decrypted = decryptField(encrypted);
  assert.equal(decrypted, plaintext);
});

test('encryptField devuelve nulls cuando el campo es null/undefined', () => {
  const result = encryptField(null);
  assert.deepEqual(result, { enc: null, iv: null, tag: null });
});

test('decryptField devuelve null cuando no hay ciphertext', () => {
  assert.equal(decryptField({ enc: null, iv: null, tag: null }), null);
});

test('decryptField rechaza si el ciphertext fue alterado (auth tag falla)', () => {
  const encrypted = encryptField('condición médica sensible');
  const tampered = { ...encrypted, enc: Buffer.concat([encrypted.enc, Buffer.from('x')]) };
  assert.throws(() => decryptField(tampered));
});

test('encryptField lanza si INTAKE_ENCRYPTION_KEY no es válida', () => {
  const original = process.env.INTAKE_ENCRYPTION_KEY;
  process.env.INTAKE_ENCRYPTION_KEY = 'no-es-base64-de-32-bytes';
  try {
    assert.throws(() => encryptField('x'), /INTAKE_ENCRYPTION_KEY/);
  } finally {
    process.env.INTAKE_ENCRYPTION_KEY = original;
  }
});
