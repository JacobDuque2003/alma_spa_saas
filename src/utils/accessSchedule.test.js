const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAccess, defaultScheduleFromBusinessHours, validateSchedule, _nowPartsInTimezone } = require('./accessSchedule');

const TZ = 'America/Guayaquil'; // UTC-5

// ---- helper de partes ----

test('_nowPartsInTimezone: 03:00 UTC un jueves en Guayaquil sigue siendo miércoles a las 22:00', () => {
  const now = new Date(Date.UTC(2026, 7, 6, 3, 0, 0)); // jueves 6-ago-2026 03:00 UTC
  const p = _nowPartsInTimezone(now, TZ);
  assert.equal(p.year, 2026);
  assert.equal(p.month, 8);
  assert.equal(p.day, 5); // miércoles todavía en Ecuador
  assert.equal(p.dayOfWeek, 3); // Wed
  assert.equal(p.hour, 22);
});

// ---- checkAccess ----

test('checkAccess: schedule null → fail-open (permitido)', () => {
  const r = checkAccess(null, new Date(), TZ);
  assert.equal(r.allowed, true);
});

test('checkAccess: schedule.alwaysAllowed=true → permitido', () => {
  const r = checkAccess({ alwaysAllowed: true }, new Date(), TZ);
  assert.equal(r.allowed, true);
});

test('checkAccess: roleAlwaysAllowed=true → bypass sin importar schedule', () => {
  const r = checkAccess({ alwaysAllowed: false, monday: null }, new Date(), TZ, { roleAlwaysAllowed: true });
  assert.equal(r.allowed, true);
});

test('checkAccess: día actual dentro de la ventana → permitido', () => {
  // Simular martes 14:00 en Guayaquil: 19:00 UTC.
  const now = new Date(Date.UTC(2026, 7, 4, 19, 0, 0)); // martes 4-ago-2026
  const schedule = { alwaysAllowed: false, tuesday: { start: '09:00', end: '18:00' } };
  const r = checkAccess(schedule, now, TZ);
  assert.equal(r.allowed, true);
});

test('checkAccess: día actual fuera de la ventana → denegado con nextWindowOpensAt', () => {
  // Martes 20:00 Guayaquil (01:00 UTC del miércoles).
  const now = new Date(Date.UTC(2026, 7, 5, 1, 0, 0));
  const schedule = {
    alwaysAllowed: false,
    tuesday:   { start: '09:00', end: '18:00' },
    wednesday: { start: '09:00', end: '18:00' },
  };
  const r = checkAccess(schedule, now, TZ);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'outOfSchedule');
  assert.ok(r.nextWindowOpensAt instanceof Date);
});

test('checkAccess: día actual con window null → denegado', () => {
  // Domingo 12:00 Guayaquil (17:00 UTC del domingo).
  const now = new Date(Date.UTC(2026, 7, 2, 17, 0, 0));
  const schedule = { alwaysAllowed: false, sunday: null, monday: { start: '09:00', end: '18:00' } };
  const r = checkAccess(schedule, now, TZ);
  assert.equal(r.allowed, false);
});

test('checkAccess: fuera de horario en Ecuador después de las 19:00 local (rollover UTC ya al día siguiente)', () => {
  // 22:00 Guayaquil = 03:00 UTC del día siguiente. Bug B reincidiría si
  // se leyera el día en UTC en vez de en la timezone local.
  const now = new Date(Date.UTC(2026, 7, 6, 3, 0, 0)); // jueves UTC = miércoles local
  const schedule = {
    alwaysAllowed: false,
    wednesday: { start: '09:00', end: '18:00' },
    thursday:  { start: '09:00', end: '18:00' },
  };
  const r = checkAccess(schedule, now, TZ);
  // La hora local es miércoles 22:00 → fuera de la ventana miércoles 09-18.
  assert.equal(r.allowed, false);
});

test('checkAccess: schedule sin el día actual definido → denegado (día implícito cerrado)', () => {
  const now = new Date(Date.UTC(2026, 7, 4, 19, 0, 0));
  const schedule = { alwaysAllowed: false, monday: { start: '09:00', end: '18:00' } };
  // Es martes 14:00 local, schedule solo define lunes.
  const r = checkAccess(schedule, now, TZ);
  assert.equal(r.allowed, false);
});

// ---- defaultScheduleFromBusinessHours ----

test('defaultScheduleFromBusinessHours: usa businessHours + workDays para preseeding', () => {
  const bh = { morning: { start: '09:00', end: '13:00' }, afternoon: { start: '15:00', end: '19:00' } };
  const workDays = [1, 2, 3, 4, 5];
  const s = defaultScheduleFromBusinessHours(bh, workDays);
  assert.equal(s.alwaysAllowed, false);
  assert.deepEqual(s.monday, { start: '09:00', end: '19:00' });
  assert.equal(s.saturday, null);
  assert.equal(s.sunday, null);
});

test('defaultScheduleFromBusinessHours: cubre 7 días', () => {
  const s = defaultScheduleFromBusinessHours({ start: '10:00', end: '18:00' }, [1, 2, 3, 4, 5, 6, 7]);
  for (const d of ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) {
    assert.ok(s[d], `día ${d} debería estar presente`);
  }
});

// ---- validateSchedule ----

test('validateSchedule: null es válido (fail-open)', () => {
  assert.equal(validateSchedule(null), null);
});

test('validateSchedule: shape correcto es válido', () => {
  assert.equal(validateSchedule({
    alwaysAllowed: false,
    monday: { start: '09:00', end: '18:00' },
    tuesday: null,
  }), null);
});

test('validateSchedule: alwaysAllowed no-booleano falla', () => {
  const err = validateSchedule({ alwaysAllowed: 'yes' });
  assert.ok(err && /booleano/.test(err));
});

test('validateSchedule: hora inválida falla con día específico', () => {
  const err = validateSchedule({ monday: { start: '9:00', end: '18:00' } });
  assert.ok(err && /monday\.start/.test(err));
});

test('validateSchedule: start >= end falla con día específico', () => {
  const err = validateSchedule({ friday: { start: '18:00', end: '09:00' } });
  assert.ok(err && /friday\.start/.test(err));
});
