const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guard de compartimentación para credenciales de WhatsApp (espeja el guard H1
 * de intakeCrypto). Allowlists distintas por token — quien puede sellar no
 * necesariamente puede abrir:
 *
 *   sealWhatsappSecret → solo whatsappConnectionService.js (el único que cifra/guarda).
 *   openWhatsappSecret → solo whatsappTransport.js (envío y verificación de webhook).
 *
 * Cualquier uso fuera de esas listas hace fallar el CI. Convierte "revisión
 * humana debe rechazarlo" en "el pipeline lo rechaza".
 */
const SEAL_ALLOWED = new Set(['whatsappConnectionService.js']);
const OPEN_ALLOWED = new Set(['whatsappTransport.js']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

test('sealWhatsappSecret solo se usa desde whatsappConnectionService.js (guard)', () => {
  const srcDir = path.join(__dirname, '..');
  const offenders = [];

  for (const file of walk(srcDir)) {
    const base = path.basename(file);
    if (base === 'whatsappCredentialCrypto.js' || base.endsWith('.test.js')) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (/\bsealWhatsappSecret\b/.test(content) && !SEAL_ALLOWED.has(base)) {
      offenders.push(base);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `sealWhatsappSecret usado fuera de la allowlist (${[...SEAL_ALLOWED].join(', ')}): ${offenders.join(', ')}`
  );
});

test('openWhatsappSecret solo se usa desde whatsappTransport.js (guard)', () => {
  const srcDir = path.join(__dirname, '..');
  const offenders = [];

  for (const file of walk(srcDir)) {
    const base = path.basename(file);
    if (base === 'whatsappCredentialCrypto.js' || base.endsWith('.test.js')) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (/\bopenWhatsappSecret\b/.test(content) && !OPEN_ALLOWED.has(base)) {
      offenders.push(base);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `openWhatsappSecret usado fuera de la allowlist (${[...OPEN_ALLOWED].join(', ')}): ${offenders.join(', ')}`
  );
});
