const test = require('node:test');
const assert = require('node:assert/strict');

const {
  intersectBusinessHours,
  serviceHoursForDate,
  validateAppointmentSchedule,
  isBusinessHoursClosed,
} = require('./serviceSchedule');

test('intersectBusinessHours cruza horario general con horario propio del servicio', () => {
  const result = intersectBusinessHours(
    { morning: { start: '09:00', end: '12:00' }, afternoon: { start: '15:00', end: '20:00' } },
    { morning: { start: '10:00', end: '16:00' }, afternoon: null }
  );

  assert.deepEqual(result, {
    morning: { start: '10:00', end: '12:00' },
    afternoon: { start: '15:00', end: '16:00' },
  });
});

test('serviceHoursForDate respeta cierre explícito del servicio por día', () => {
  const result = serviceHoursForDate(
    { workDays: [1, 2, 3, 4, 5, 6], businessHours: { morning: { start: '09:00', end: '12:00' }, afternoon: null } },
    { name: 'Masaje', appointmentSchedule: { monday: null } },
    '2099-08-03'
  );

  assert.equal(isBusinessHoursClosed(result.hours), true);
  assert.match(result.closedReason, /lunes/);
});

test('serviceHoursForDate hereda horario del servicio principal si el subservicio no define uno propio', () => {
  const result = serviceHoursForDate(
    { workDays: [1, 2, 3, 4, 5, 6], businessHours: { morning: { start: '09:00', end: '12:00' }, afternoon: null } },
    {
      name: 'Masaje con piedras',
      appointmentSchedule: null,
      parentService: { appointmentSchedule: { monday: { morning: { start: '10:00', end: '11:00' }, afternoon: null } } },
    },
    '2099-08-03'
  );

  assert.deepEqual(result.hours, {
    morning: { start: '10:00', end: '11:00' },
    afternoon: null,
  });
  assert.equal(result.source, 'parent');
});

test('validateAppointmentSchedule rechaza días y ventanas inválidas', () => {
  assert.match(validateAppointmentSchedule({ viernes: null }), /no es un día válido/);
  assert.match(
    validateAppointmentSchedule({ monday: { morning: { start: '18:00', end: '09:00' }, afternoon: null } }),
    /start debe ser anterior/
  );
});
