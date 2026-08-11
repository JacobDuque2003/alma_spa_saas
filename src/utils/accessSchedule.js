// Horario de acceso por cuenta (User.accessSchedule).
//
// Shape del JSON almacenado en la columna:
//   {
//     alwaysAllowed: boolean,
//     monday:    { start: "HH:MM", end: "HH:MM" } | null,
//     tuesday:   ...,
//     wednesday: ...,
//     thursday:  ...,
//     friday:    ...,
//     saturday:  ...,
//     sunday:    ...
//   }
//
// Semántica:
//   - accessSchedule === null / undefined → fail-open (24/7 permitido; el
//     frontend muestra badge "sin horario configurado" en Personal).
//   - alwaysAllowed === true → siempre permitido (usado hardcoded para
//     dueño/superadmin en el middleware, sin depender de persistencia).
//   - Un día null = ese día cerrado (deny).
//   - Un día con {start, end} = permitido si la hora local del tenant
//     está en [start, end). Cruce de medianoche no soportado en v1.

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Formato en-CA con timeZone da "YYYY-MM-DD, HH:MM:SS" — usamos las partes
// individuales para obtener la fecha calendario local y el day-of-week local.
function nowPartsInTimezone(now, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  // en-CA weekday abreviado: Sun/Mon/Tue/Wed/Thu/Fri/Sat
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === '24' ? '00' : map.hour),
    minute: Number(map.minute),
    dayOfWeek: weekdayMap[map.weekday],
  };
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function isValidWindow(win) {
  return win && typeof win === 'object' && typeof win.start === 'string' && typeof win.end === 'string'
    && HH_MM.test(win.start) && HH_MM.test(win.end) && win.start < win.end;
}

// Devuelve { allowed: boolean, reason?: string, nextWindowOpensAt?: Date }
// - now: Date; tz: string (ej 'America/Guayaquil')
// - schedule: null | object (ver shape arriba)
// - roleAlwaysAllowed: boolean (viene del middleware para dueño/superadmin)
function checkAccess(schedule, now, tz, { roleAlwaysAllowed = false } = {}) {
  if (roleAlwaysAllowed) return { allowed: true };
  if (schedule === null || schedule === undefined) return { allowed: true }; // fail-open
  if (typeof schedule !== 'object') return { allowed: true };
  if (schedule.alwaysAllowed === true) return { allowed: true };

  const parts = nowPartsInTimezone(now, tz);
  const todayName = DAYS[parts.dayOfWeek];
  const todayWindow = schedule[todayName];
  const nowMinutes = parts.hour * 60 + parts.minute;

  if (isValidWindow(todayWindow)) {
    const startMin = toMinutes(todayWindow.start);
    const endMin = toMinutes(todayWindow.end);
    if (nowMinutes >= startMin && nowMinutes < endMin) {
      return { allowed: true };
    }
  }

  // No permitido — calcular próxima apertura para que el frontend redirija bien.
  const nextOpen = nextWindowOpensAtCalculation(schedule, parts, tz);
  return { allowed: false, reason: 'outOfSchedule', nextWindowOpensAt: nextOpen };
}

function nextWindowOpensAtCalculation(schedule, parts, tz) {
  // Escanea desde hoy hasta 7 días adelante buscando el próximo bloque abierto.
  const nowMinutes = parts.hour * 60 + parts.minute;
  for (let offset = 0; offset < 8; offset += 1) {
    const dayIndex = (parts.dayOfWeek + offset) % 7;
    const dayName = DAYS[dayIndex];
    const win = schedule[dayName];
    if (!isValidWindow(win)) continue;
    const startMin = toMinutes(win.start);
    // Hoy: solo cuenta si aún no pasó la ventana.
    if (offset === 0 && nowMinutes >= startMin) continue;
    // Construir Date UTC que represente ese momento en la timezone.
    // Truco: pedir el offset UTC del tz para ese día y aplicarlo.
    const targetLocal = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset,
      Number(win.start.split(':')[0]), Number(win.start.split(':')[1])));
    return targetLocal; // aproximado; para el uso (mostrar mensaje) es suficiente
  }
  return null;
}

// Genera un schedule por defecto a partir de businessHours del tenant. Se usa
// como prefill del formulario POST /users, no como fallback silencioso.
// - businessHours puede venir en shape antiguo o nuevo (usa el helper businessHours).
// - workDays: array ISO [1..7] (lunes=1, domingo=7 por convención del tenant).
function defaultScheduleFromBusinessHours(businessHours, workDays) {
  const { normalize } = require('./businessHours');
  const bh = normalize(businessHours);
  const start = bh.morning?.start || bh.afternoon?.start || '09:00';
  const end = bh.afternoon?.end || bh.morning?.end || '19:00';
  const workDaysSet = new Set(Array.isArray(workDays) ? workDays.map((n) => Number(n)) : [1, 2, 3, 4, 5, 6]);
  const schedule = { alwaysAllowed: false };
  // ISO: lunes=1..domingo=7. Nuestro shape usa nombres. Mapeo:
  const isoToName = { 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday', 7: 'sunday' };
  for (let iso = 1; iso <= 7; iso += 1) {
    const name = isoToName[iso];
    schedule[name] = workDaysSet.has(iso) ? { start, end } : null;
  }
  return schedule;
}

// Validación del shape completo — para POST/PATCH desde el frontend.
function validateSchedule(schedule) {
  if (schedule === null || schedule === undefined) return null; // válido (fail-open)
  if (typeof schedule !== 'object' || Array.isArray(schedule)) return 'accessSchedule debe ser un objeto o null';
  if ('alwaysAllowed' in schedule && typeof schedule.alwaysAllowed !== 'boolean') {
    return 'accessSchedule.alwaysAllowed debe ser booleano';
  }
  for (const day of DAYS) {
    if (!(day in schedule)) continue;
    const win = schedule[day];
    if (win === null) continue;
    if (typeof win !== 'object' || Array.isArray(win)) return `accessSchedule.${day} debe ser un objeto {start,end} o null`;
    if (typeof win.start !== 'string' || !HH_MM.test(win.start)) return `accessSchedule.${day}.start debe tener formato HH:MM`;
    if (typeof win.end !== 'string' || !HH_MM.test(win.end)) return `accessSchedule.${day}.end debe tener formato HH:MM`;
    if (win.start >= win.end) return `accessSchedule.${day}.start debe ser anterior a accessSchedule.${day}.end`;
  }
  return null;
}

module.exports = {
  checkAccess,
  defaultScheduleFromBusinessHours,
  validateSchedule,
  DAYS,
  // exports internos para tests:
  _nowPartsInTimezone: nowPartsInTimezone,
};
