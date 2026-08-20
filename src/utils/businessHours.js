// Normalización de Tenant.config.businessHours.
//
// Shape antiguo:  { start: "09:00", end: "19:00" }
// Shape nuevo:    { morning: { start, end } | null, afternoon: { start, end } | null }
//
// Todo el resto del backend consume `normalize(bh)` y opera sobre el shape
// nuevo. El shape antiguo se acepta como entrada durante la transición y se
// convierte a morning único (afternoon = null). Cuando el frontend guarda,
// escribe el shape nuevo, así los tenants migran solos con el próximo save.

const DEFAULT_BUSINESS_HOURS_NEW = {
  morning: { start: '09:00', end: '12:00' },
  afternoon: { start: '15:00', end: '20:00' },
};

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidWindow(w) {
  return w && typeof w === 'object' && typeof w.start === 'string' && typeof w.end === 'string'
    && HH_MM.test(w.start) && HH_MM.test(w.end) && w.start < w.end;
}

// Devuelve { morning, afternoon } — siempre. Cualquiera puede ser null.
// Si el input es el shape antiguo { start, end }, la ventana única va a morning.
// Si el input es inválido/ausente (no es un objeto, o no trae morning/afternoon
// en absoluto), devuelve el default. Si el input SÍ trae explícitamente el
// shape nuevo pero ambas ventanas resuelven a null, se respeta como "cerrado"
// — no se reinterpreta como "sin configurar". validateShape() ya impide que
// un Tenant.config.businessHours real se guarde así (exige al menos una
// franja), así que este caso solo se da hoy en el uso por-cabina de
// appointmentService.js (Room.schedule con un día explícitamente cerrado).
function normalize(bh) {
  if (!bh || typeof bh !== 'object') return { ...DEFAULT_BUSINESS_HOURS_NEW };

  // Shape nuevo — validar cada ventana independientemente.
  if ('morning' in bh || 'afternoon' in bh) {
    const morning = isValidWindow(bh.morning) ? { start: bh.morning.start, end: bh.morning.end } : null;
    const afternoon = isValidWindow(bh.afternoon) ? { start: bh.afternoon.start, end: bh.afternoon.end } : null;
    return { morning, afternoon };
  }

  // Shape antiguo — sintetizar como una sola ventana morning.
  if (isValidWindow(bh)) {
    return { morning: { start: bh.start, end: bh.end }, afternoon: null };
  }

  return { ...DEFAULT_BUSINESS_HOURS_NEW };
}

// Suma total de horas útiles del día, respetando ambas ventanas.
// Usado por reportService.parseHoursRange para calcular capacidad teórica.
function totalHours(bh) {
  const n = normalize(bh);
  let total = 0;
  for (const win of [n.morning, n.afternoon]) {
    if (!win) continue;
    const [sh, sm] = win.start.split(':').map(Number);
    const [eh, em] = win.end.split(':').map(Number);
    total += (eh * 60 + em - sh * 60 - sm) / 60;
  }
  return total;
}

// Itera las horas enteras dentro de ambas ventanas.
// Ej: morning 09:00-13:00 + afternoon 15:00-19:00 → [9, 10, 11, 12, 15, 16, 17, 18].
// Si morning.end === afternoon.start (ventana continua) evita duplicar.
function* iterateHours(bh) {
  const n = normalize(bh);
  const emitted = new Set();
  for (const win of [n.morning, n.afternoon]) {
    if (!win) continue;
    const startHour = Number(win.start.split(':')[0]);
    const endHour = Number(win.end.split(':')[0]);
    for (let h = startHour; h < endHour; h += 1) {
      if (!emitted.has(h)) {
        emitted.add(h);
        yield h;
      }
    }
  }
}

function minutesFromHHMM(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function isRangeInsideBusinessHours(bh, startHHMM, endHHMM) {
  if (!HH_MM.test(startHHMM) || !HH_MM.test(endHHMM) || startHHMM >= endHHMM) return false;
  const start = minutesFromHHMM(startHHMM);
  const end = minutesFromHHMM(endHHMM);
  const n = normalize(bh);
  return [n.morning, n.afternoon].some((win) => {
    if (!win) return false;
    return start >= minutesFromHHMM(win.start) && end <= minutesFromHHMM(win.end);
  });
}

// Validación estricta del shape nuevo, con mensajes que usa la ruta PATCH.
// Acepta también el shape antiguo (para el período de transición); si viene
// como shape antiguo se aplica la validación de start<end y ya.
function validateShape(bh) {
  if (typeof bh !== 'object' || bh === null || Array.isArray(bh)) {
    return 'businessHours debe ser un objeto';
  }

  // Shape antiguo (single window) — acepta y valida
  if (!('morning' in bh) && !('afternoon' in bh)) {
    if (typeof bh.start !== 'string' || !HH_MM.test(bh.start)) return 'businessHours.start debe tener formato HH:MM (00:00-23:59)';
    if (typeof bh.end !== 'string' || !HH_MM.test(bh.end)) return 'businessHours.end debe tener formato HH:MM (00:00-23:59)';
    if (bh.start >= bh.end) return 'businessHours.start debe ser anterior a businessHours.end';
    return null;
  }

  // Shape nuevo — cada ventana es opcional (null o ausente = cerrada), pero
  // al menos una debe estar presente y válida.
  const validateWindow = (win, label) => {
    if (win === null || win === undefined) return null;
    if (typeof win !== 'object' || Array.isArray(win)) return `businessHours.${label} debe ser un objeto {start,end} o null`;
    if (typeof win.start !== 'string' || !HH_MM.test(win.start)) return `businessHours.${label}.start debe tener formato HH:MM (00:00-23:59)`;
    if (typeof win.end !== 'string' || !HH_MM.test(win.end)) return `businessHours.${label}.end debe tener formato HH:MM (00:00-23:59)`;
    if (win.start >= win.end) return `businessHours.${label}.start debe ser anterior a businessHours.${label}.end`;
    return null;
  };

  const morningErr = validateWindow(bh.morning, 'morning');
  if (morningErr) return morningErr;
  const afternoonErr = validateWindow(bh.afternoon, 'afternoon');
  if (afternoonErr) return afternoonErr;

  const morningPresent = bh.morning !== null && bh.morning !== undefined;
  const afternoonPresent = bh.afternoon !== null && bh.afternoon !== undefined;
  if (!morningPresent && !afternoonPresent) return 'businessHours debe tener al menos una franja (morning o afternoon)';

  // Si ambas presentes, morning.end debe ser <= afternoon.start.
  if (morningPresent && afternoonPresent && bh.morning.end > bh.afternoon.start) {
    return 'businessHours.morning.end debe ser menor o igual a businessHours.afternoon.start';
  }

  return null;
}

module.exports = { normalize, totalHours, iterateHours, isRangeInsideBusinessHours, validateShape, DEFAULT_BUSINESS_HOURS_NEW };
