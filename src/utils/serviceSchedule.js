const { normalize: normalizeBusinessHours, validateShape } = require('./businessHours');

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_LABELS = {
  sunday: 'domingo',
  monday: 'lunes',
  tuesday: 'martes',
  wednesday: 'miércoles',
  thursday: 'jueves',
  friday: 'viernes',
  saturday: 'sábado',
};

function minutesFromHHMM(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function hhmmFromMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function windowsOf(bh) {
  const n = normalizeBusinessHours(bh);
  return [n.morning, n.afternoon]
    .filter(Boolean)
    .map((win) => ({ start: minutesFromHHMM(win.start), end: minutesFromHHMM(win.end) }))
    .filter((win) => win.start < win.end);
}

function closedBusinessHours() {
  return { morning: null, afternoon: null };
}

function isBusinessHoursClosed(bh) {
  const n = normalizeBusinessHours(bh);
  return !n.morning && !n.afternoon;
}

function intersectBusinessHours(...items) {
  const usable = items.filter(Boolean);
  if (usable.length === 0) return normalizeBusinessHours(null);

  let current = windowsOf(usable[0]);
  for (const item of usable.slice(1)) {
    const next = windowsOf(item);
    const intersections = [];
    for (const a of current) {
      for (const b of next) {
        const start = Math.max(a.start, b.start);
        const end = Math.min(a.end, b.end);
        if (start < end) intersections.push({ start, end });
      }
    }
    current = intersections;
    if (current.length === 0) return closedBusinessHours();
  }

  current.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const win of current) {
    const last = merged[merged.length - 1];
    if (last && win.start <= last.end) {
      last.end = Math.max(last.end, win.end);
    } else {
      merged.push({ ...win });
    }
  }

  return {
    morning: merged[0] ? { start: hhmmFromMinutes(merged[0].start), end: hhmmFromMinutes(merged[0].end) } : null,
    afternoon: merged[1] ? { start: hhmmFromMinutes(merged[1].start), end: hhmmFromMinutes(merged[1].end) } : null,
  };
}

function dayKeyFromDateStr(dateStr) {
  return DAY_KEYS[new Date(`${dateStr}T12:00:00`).getDay()];
}

function isoWeekdayFromDateStr(dateStr) {
  const jsDay = new Date(`${dateStr}T12:00:00`).getDay();
  return jsDay === 0 ? 7 : jsDay;
}

function normalizeWorkDays(workDays) {
  const fallback = [1, 2, 3, 4, 5, 6];
  if (!Array.isArray(workDays)) return fallback;
  const normalized = workDays
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .map((n) => (n === 0 ? 7 : n))
    .filter((n) => n >= 1 && n <= 7);
  return [...new Set(normalized)];
}

function isTenantWorkDay(tenantConfig, dateStr) {
  return normalizeWorkDays(tenantConfig?.workDays).includes(isoWeekdayFromDateStr(dateStr));
}

function validateAppointmentSchedule(schedule, field = 'appointmentSchedule') {
  if (schedule === undefined || schedule === null) return null;
  if (typeof schedule !== 'object' || Array.isArray(schedule)) {
    return `${field} debe ser un objeto semanal o null`;
  }
  for (const [day, value] of Object.entries(schedule)) {
    if (!DAY_KEYS.includes(day)) return `${field}.${day} no es un día válido`;
    if (value === null) continue;
    const err = validateShape(value);
    if (err) return err.replaceAll('businessHours', `${field}.${day}`);
  }
  return null;
}

function effectiveServiceSchedule(service) {
  if (service?.appointmentSchedule && typeof service.appointmentSchedule === 'object') {
    return service.appointmentSchedule;
  }
  const parentSchedule = service?.parentService?.appointmentSchedule;
  if (parentSchedule && typeof parentSchedule === 'object') return parentSchedule;
  return null;
}

function serviceScheduleSource(service) {
  if (service?.appointmentSchedule && typeof service.appointmentSchedule === 'object') return 'service';
  if (service?.parentService?.appointmentSchedule && typeof service.parentService.appointmentSchedule === 'object') return 'parent';
  return 'tenant';
}

function serviceHoursForDate(tenantConfig, service, dateStr) {
  const dayKey = dayKeyFromDateStr(dateStr);
  if (!isTenantWorkDay(tenantConfig, dateStr)) {
    return {
      hours: closedBusinessHours(),
      closedReason: `El ${DAY_LABELS[dayKey]} no está marcado como día laboral del spa.`,
      source: 'tenant',
    };
  }

  const base = normalizeBusinessHours(tenantConfig?.businessHours);
  const schedule = effectiveServiceSchedule(service);
  if (!schedule || !Object.prototype.hasOwnProperty.call(schedule, dayKey)) {
    return { hours: base, closedReason: null, source: 'tenant' };
  }

  const dayValue = schedule[dayKey];
  const source = serviceScheduleSource(service);
  if (dayValue === null) {
    return {
      hours: closedBusinessHours(),
      closedReason: `Este servicio no se atiende los ${DAY_LABELS[dayKey]}.`,
      source,
    };
  }

  const hours = intersectBusinessHours(base, normalizeBusinessHours(dayValue));
  return {
    hours,
    closedReason: isBusinessHoursClosed(hours)
      ? `El horario de este servicio no coincide con el horario general del spa para ese ${DAY_LABELS[dayKey]}.`
      : null,
    source,
  };
}

module.exports = {
  DAY_KEYS,
  DAY_LABELS,
  validateAppointmentSchedule,
  effectiveServiceSchedule,
  serviceScheduleSource,
  serviceHoursForDate,
  dayKeyFromDateStr,
  isTenantWorkDay,
  normalizeWorkDays,
  intersectBusinessHours,
  isBusinessHoursClosed,
  closedBusinessHours,
};
