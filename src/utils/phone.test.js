const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, isValidE164 } = require('./phone');

// Bug 2: la dueña escribe formatos locales de Ecuador que antes
// terminaban como "+0993..." o "+993..." y fallaban la validación E.164.

test('normalizePhone: formato Ecuador local 0993629257 → +593993629257', () => {
  assert.equal(normalizePhone('0993629257'), '+593993629257');
});

test('normalizePhone: sin leading 0 (993629257) → +593993629257', () => {
  assert.equal(normalizePhone('993629257'), '+593993629257');
});

test('normalizePhone: código país sin + (593993629257) → +593993629257', () => {
  assert.equal(normalizePhone('593993629257'), '+593993629257');
});

test('normalizePhone: internacional +593993629257 pasa sin cambio', () => {
  assert.equal(normalizePhone('+593993629257'), '+593993629257');
});

test('normalizePhone: espacios y guiones se limpian antes de la detección', () => {
  assert.equal(normalizePhone('099 362 9257'), '+593993629257');
  assert.equal(normalizePhone('099-362-9257'), '+593993629257');
  assert.equal(normalizePhone('(099) 362-9257'), '+593993629257');
});

test('normalizePhone: número extranjero (12 dígitos empezando por +1) pasa como internacional', () => {
  assert.equal(normalizePhone('+15551234567'), '+15551234567');
});

test('normalizePhone: fallback prefija + sin adivinar país', () => {
  // 8 dígitos: no matchea ninguna convención Ecuador, cae al fallback.
  assert.equal(normalizePhone('12345678'), '+12345678');
});

test('isValidE164: los formatos normalizados de Ecuador ahora pasan la validación', () => {
  assert.equal(isValidE164(normalizePhone('0993629257')), true);
  assert.equal(isValidE164(normalizePhone('993629257')), true);
  assert.equal(isValidE164(normalizePhone('+593993629257')), true);
});

test('normalizePhone: string vacío devuelve ""', () => {
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone(null), '');
  assert.equal(normalizePhone(undefined), '');
});
