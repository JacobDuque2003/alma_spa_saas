const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guard H1 (Fase 4): las operaciones de cifrado de datos de salud
 * (encryptField/decryptField) solo pueden usarse desde los servicios
 * sancionados, para que ningún módulo futuro cifre/descifre anamnesis o notas
 * sin pasar por su capa de auditoría/validación. (El helper de arranque
 * assertEncryptionKeyOrExit NO es una operación de cifrado y puede importarse
 * libremente, ej. desde app.js.)
 *
 * Se implementa como test (no como regla ESLint) porque el proyecto no tiene
 * ESLint configurado; el efecto es el mismo: falla `npm test` / CI si alguien
 * usa encryptField/decryptField fuera de la lista blanca.
 */
const SANCTIONED = new Set(['clientIntakeService.js', 'treatmentHistoryService.js']);

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

test('encryptField/decryptField solo se usan desde los servicios sancionados (guard H1)', () => {
  const srcDir = path.join(__dirname, '..');
  const offenders = [];

  for (const file of walk(srcDir)) {
    const base = path.basename(file);
    if (base === 'intakeCrypto.js' || base.endsWith('.test.js')) continue; // el módulo mismo y los tests están exentos

    const content = fs.readFileSync(file, 'utf8');
    const usesCryptoOps = /\b(encryptField|decryptField)\b/.test(content);
    if (usesCryptoOps && !SANCTIONED.has(base)) {
      offenders.push(base);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `encryptField/decryptField usados fuera de la lista blanca (${[...SANCTIONED].join(', ')}): ${offenders.join(', ')}`
  );
});
