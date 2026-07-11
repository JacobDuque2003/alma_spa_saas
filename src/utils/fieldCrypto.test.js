const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { makeFieldCrypto, assertKeyOrExit } = require('./fieldCrypto');

const KEY_NAME = 'FIELD_CRYPTO_TEST_KEY';

function withKey(fn) {
  process.env[KEY_NAME] = crypto.randomBytes(32).toString('base64');
  try { return fn(); } finally { delete process.env[KEY_NAME]; }
}

test('makeFieldCrypto: roundtrip cifra y descifra el mismo texto', () => {
  withKey(() => {
    const { encrypt, decrypt } = makeFieldCrypto(KEY_NAME);
    const enc = encrypt('mensaje secreto');
    assert.ok(Buffer.isBuffer(enc.enc));
    assert.equal(enc.iv.length, 12);
    assert.equal(enc.tag.length, 16);
    assert.equal(decrypt(enc), 'mensaje secreto');
  });
});

test('makeFieldCrypto: null/undefined devuelve tripleta nula (sin cifrar)', () => {
  withKey(() => {
    const { encrypt } = makeFieldCrypto(KEY_NAME);
    assert.deepEqual(encrypt(null), { enc: null, iv: null, tag: null });
    assert.deepEqual(encrypt(undefined), { enc: null, iv: null, tag: null });
  });
});

test('makeFieldCrypto: resolución LAZY — borrar la env var a mitad hace fallar la siguiente op', () => {
  // Regresión crítica: Fase 4 tests borran INTAKE_ENCRYPTION_KEY entre llamadas
  // y esperan que se lance. Si la factory cachea la clave al construirse, ese
  // test se rompería. Éste blinda la resolución lazy por llamada.
  process.env[KEY_NAME] = crypto.randomBytes(32).toString('base64');
  const { encrypt } = makeFieldCrypto(KEY_NAME);
  encrypt('primero').enc; // funciona
  delete process.env[KEY_NAME];
  assert.throws(() => encrypt('segundo'), new RegExp(KEY_NAME));
});

test('makeFieldCrypto: mensaje de error contiene el nombre de la env var', () => {
  delete process.env[KEY_NAME];
  const { encrypt } = makeFieldCrypto(KEY_NAME);
  assert.throws(() => encrypt('x'), new RegExp(KEY_NAME));
});

test('makeFieldCrypto: rechaza clave de longitud incorrecta', () => {
  process.env[KEY_NAME] = Buffer.alloc(16).toString('base64'); // 16 bytes, no 32
  try {
    const { encrypt } = makeFieldCrypto(KEY_NAME);
    assert.throws(() => encrypt('x'), /debe decodificar a 32 bytes/);
  } finally {
    delete process.env[KEY_NAME];
  }
});

test('makeFieldCrypto: auth tag alterado hace fallar decrypt (integridad GCM)', () => {
  withKey(() => {
    const { encrypt, decrypt } = makeFieldCrypto(KEY_NAME);
    const enc = encrypt('sensible');
    const brokenTag = Buffer.from(enc.tag); brokenTag[0] ^= 0xff;
    assert.throws(() => decrypt({ enc: enc.enc, iv: enc.iv, tag: brokenTag }));
  });
});

test('assertKeyOrExit: no lanza cuando la clave es válida', () => {
  withKey(() => {
    assertKeyOrExit(KEY_NAME); // no debería llamar process.exit
  });
});
