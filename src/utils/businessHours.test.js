const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, totalHours, iterateHours, isRangeInsideBusinessHours, validateShape } = require('./businessHours');

// --- normalize ---

test('normalize: shape antiguo {start,end} → morning único, afternoon null', () => {
  const n = normalize({ start: '09:00', end: '19:00' });
  assert.deepEqual(n, { morning: { start: '09:00', end: '19:00' }, afternoon: null });
});

test('normalize: shape nuevo se pasa tal cual', () => {
  const bh = { morning: { start: '09:00', end: '13:00' }, afternoon: { start: '15:00', end: '19:00' } };
  assert.deepEqual(normalize(bh), bh);
});

test('normalize: solo morning (afternoon null explícito)', () => {
  const n = normalize({ morning: { start: '10:00', end: '14:00' }, afternoon: null });
  assert.deepEqual(n.morning, { start: '10:00', end: '14:00' });
  assert.equal(n.afternoon, null);
});

test('normalize: solo afternoon (morning null) — el spa solo abre en la tarde', () => {
  const n = normalize({ morning: null, afternoon: { start: '15:00', end: '20:00' } });
  assert.equal(n.morning, null);
  assert.deepEqual(n.afternoon, { start: '15:00', end: '20:00' });
});

test('normalize: input null/vacío → default', () => {
  const n = normalize(null);
  assert.deepEqual(n, { morning: { start: '09:00', end: '12:00' }, afternoon: { start: '15:00', end: '20:00' } });
});

test('normalize: shape mal formado (start > end) → default', () => {
  const n = normalize({ start: '19:00', end: '09:00' });
  assert.deepEqual(n, { morning: { start: '09:00', end: '12:00' }, afternoon: { start: '15:00', end: '20:00' } });
});

// --- totalHours ---

test('totalHours: shape antiguo 09:00-19:00 → 10 horas', () => {
  assert.equal(totalHours({ start: '09:00', end: '19:00' }), 10);
});

test('totalHours: shape nuevo 09-13 + 15-19 → 8 horas (no 10)', () => {
  const h = totalHours({ morning: { start: '09:00', end: '13:00' }, afternoon: { start: '15:00', end: '19:00' } });
  assert.equal(h, 8);
});

test('totalHours: solo morning cuenta lo suyo', () => {
  assert.equal(totalHours({ morning: { start: '10:00', end: '14:00' }, afternoon: null }), 4);
});

// --- iterateHours ---

test('iterateHours: shape antiguo 09-12 → [9,10,11]', () => {
  const hs = [...iterateHours({ start: '09:00', end: '12:00' })];
  assert.deepEqual(hs, [9, 10, 11]);
});

test('iterateHours: shape nuevo 09-13 + 15-19 → [9,10,11,12,15,16,17,18]', () => {
  const hs = [...iterateHours({ morning: { start: '09:00', end: '13:00' }, afternoon: { start: '15:00', end: '19:00' } })];
  assert.deepEqual(hs, [9, 10, 11, 12, 15, 16, 17, 18]);
});

test('iterateHours: morning.end === afternoon.start (sin gap) → no duplica horas', () => {
  const hs = [...iterateHours({ morning: { start: '09:00', end: '13:00' }, afternoon: { start: '13:00', end: '19:00' } })];
  assert.deepEqual(hs, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
});

test('isRangeInsideBusinessHours: respeta pausa de mediodía', () => {
  const bh = { morning: { start: '09:00', end: '12:00' }, afternoon: { start: '15:00', end: '20:00' } };
  assert.equal(isRangeInsideBusinessHours(bh, '10:00', '11:00'), true);
  assert.equal(isRangeInsideBusinessHours(bh, '13:00', '14:00'), false);
  assert.equal(isRangeInsideBusinessHours(bh, '19:00', '20:00'), true);
});

// --- validateShape ---

test('validateShape: shape antiguo válido pasa (null)', () => {
  assert.equal(validateShape({ start: '09:00', end: '19:00' }), null);
});

test('validateShape: shape nuevo con solo morning pasa', () => {
  assert.equal(validateShape({ morning: { start: '09:00', end: '13:00' }, afternoon: null }), null);
});

test('validateShape: shape nuevo con solo afternoon pasa', () => {
  assert.equal(validateShape({ morning: null, afternoon: { start: '15:00', end: '19:00' } }), null);
});

test('validateShape: shape nuevo con ambas null falla', () => {
  const err = validateShape({ morning: null, afternoon: null });
  assert.ok(err && /al menos una franja/.test(err));
});

test('validateShape: morning.end > afternoon.start (solapan) falla', () => {
  const err = validateShape({ morning: { start: '09:00', end: '14:00' }, afternoon: { start: '13:00', end: '19:00' } });
  assert.ok(err && /morning.end debe ser menor/.test(err));
});

test('validateShape: hora inválida falla con mensaje específico', () => {
  const err = validateShape({ morning: { start: '09:XX', end: '13:00' }, afternoon: null });
  assert.ok(err && /morning\.start/.test(err));
});

test('validateShape: shape nuevo con start>=end falla', () => {
  const err = validateShape({ morning: { start: '13:00', end: '09:00' }, afternoon: null });
  assert.ok(err && /morning\.start debe ser anterior/.test(err));
});
