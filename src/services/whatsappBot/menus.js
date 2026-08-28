const MAIN_MENU_IDS = {
  LIST_SERVICES: 'menu_list_services',
  BOOK: 'menu_book',
  MY_APPOINTMENT: 'menu_my_appointment',
  ESCALATE: 'menu_escalate',
};

const SERVICE_PREFIX = 'svc_';
const CATEGORY_PREFIX = 'cat_';
const NAV_BACK_MENU = 'nav_menu';
const BOOK_DATE_PREFIX = 'bkd_';
const BOOK_TIME_PREFIX = 'bkt_';
const BOOK_CONFIRM_YES = 'bk_yes';
const BOOK_CONFIRM_NO = 'bk_no';
const SPA_TZ = 'America/Guayaquil';

const CATEGORY_DISPLAY_NAMES = {
  corporal: '\u{1F486}‍♀️ Cuerpo y Relajación',
  facial: '✨ Tratamientos Faciales',
  terapias: '\u{1F33F} Terapias Holísticas',
  laser: '⚡ Depilación Láser',
  ceragem: '\u{1F6CF}️ Camilla Ceragem',
  yoga: '\u{1F9D8} Aero Yoga',
  pies: '\u{1F9B6} Cuidado de Pies',
};

const HIDDEN_CATEGORIES = new Set(['tienda', 'recordatorio']);

function categoryDisplayName(raw) {
  const key = String(raw).toLowerCase().trim();
  return CATEGORY_DISPLAY_NAMES[key] || capitalize(raw);
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function greeting(tone) {
  return tone === 'tu'
    ? '✨ ¡Hola! Soy Almita, tu asistente de Alma Spa 🌿'
    : '✨ ¡Hola! Soy Almita, su asistente de Alma Spa 🌿';
}

function verbYouCan(tone) {
  return tone === 'tu' ? '¿En qué te puedo ayudar?' : '¿En qué le puedo ayudar?';
}

function mainMenu({ tone } = {}) {
  return {
    type: 'list',
    body: { text: `${greeting(tone)}\n${verbYouCan(tone)}` },
    footer: { text: 'Alma Spa · Zamora 🌿' },
    action: {
      button: 'Ver opciones',
      sections: [
        {
          title: 'Menú',
          rows: [
            { id: MAIN_MENU_IDS.LIST_SERVICES, title: 'Ver servicios', description: '💆‍♀️ Nuestra carta con precios' },
            { id: MAIN_MENU_IDS.BOOK, title: 'Reservar cita', description: '📅 Agenda tu hora por la web' },
            { id: MAIN_MENU_IDS.MY_APPOINTMENT, title: 'Mi cita', description: '📋 Consulta tu próxima cita' },
            { id: MAIN_MENU_IDS.ESCALATE, title: 'Hablar con recepción', description: '👋 Te conectamos con el equipo' },
          ],
        },
      ],
    },
  };
}

function mainMenuText({ tone } = {}) {
  const instruction = tone === 'tu' ? 'Responde con una opción:' : 'Responda con una opción:';
  return `${greeting(tone)}
${verbYouCan(tone)}

${instruction}
1. Ver servicios
2. Reservar cita
3. Consultar mi cita
4. Hablar con recepción`;
}

// Flat service list — only used when total active services ≤ 10 (Meta's
// hard limit is 10 rows across all sections in an interactive list).
function servicesList(services, { tone, body } = {}) {
  const byCat = new Map();
  for (const s of services) {
    if (!s.active) continue;
    const cat = String(s.category || 'Otros');
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(s);
  }
  const sections = [];
  let totalRows = 0;
  for (const [cat, items] of [...byCat.entries()].sort()) {
    const remaining = 10 - totalRows;
    if (remaining <= 0) break;
    const rows = items
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .slice(0, remaining)
      .map((s) => ({
        id: `${SERVICE_PREFIX}${s.id}`,
        title: String(s.name).slice(0, 24),
        description: `$${Number(s.priceUsd).toFixed(2)} · ${s.durationMins || 60} min`.slice(0, 72),
      }));
    if (rows.length) {
      sections.push({ title: categoryDisplayName(cat).slice(0, 24), rows });
      totalRows += rows.length;
    }
  }

  const defaultBody = tone === 'tu'
    ? '💆‍♀️ Estos son nuestros servicios. Toca uno para ver más:'
    : '💆‍♀️ Estos son nuestros servicios. Toque uno para ver más:';
  return {
    type: 'list',
    body: { text: body || defaultBody },
    footer: { text: 'Alma Spa 🌿' },
    action: {
      button: 'Ver servicios',
      sections: sections.slice(0, 10),
    },
  };
}

function categoryList(categories, { tone, body } = {}) {
  const visible = categories.filter((c) => !HIDDEN_CATEGORIES.has(String(c.name).toLowerCase().trim()));
  const rows = visible.slice(0, 10).map((c) => ({
    id: `${CATEGORY_PREFIX}${c.name}`,
    title: categoryDisplayName(c.name).slice(0, 24),
    description: `${c.count} servicio${c.count === 1 ? '' : 's'}`.slice(0, 72),
  }));
  const defaultBody = tone === 'tu'
    ? '💆‍♀️ Tenemos varios servicios. Elige una categoría:'
    : '💆‍♀️ Tenemos varios servicios. Elija una categoría:';
  return {
    type: 'list',
    body: { text: body || defaultBody },
    footer: { text: 'Alma Spa 🌿' },
    action: {
      button: 'Ver categorías',
      sections: [{ title: 'Categorías', rows }],
    },
  };
}

function servicesInCategory(services, categoryName, { tone } = {}) {
  const rows = services.slice(0, 10).map((s) => ({
    id: `${SERVICE_PREFIX}${s.id}`,
    title: String(s.name).slice(0, 24),
    description: `$${Number(s.priceUsd).toFixed(2)} · ${s.durationMins || 60} min`.slice(0, 72),
  }));
  const label = categoryDisplayName(categoryName).slice(0, 30);
  return {
    type: 'list',
    body: { text: tone === 'tu'
      ? `✨ Servicios de ${label}. Toca uno para ver más:`
      : `✨ Servicios de ${label}. Toque uno para ver más:` },
    footer: { text: 'Alma Spa 🌿' },
    action: {
      button: 'Ver servicios',
      sections: [{ title: categoryDisplayName(categoryName).slice(0, 24), rows }],
    },
  };
}

function backToMenuButton({ tone } = {}) {
  return {
    type: 'button',
    body: { text: tone === 'tu' ? '¿Te muestro algo más? 🌿' : '¿Le muestro algo más? 🌿' },
    action: {
      buttons: [
        { type: 'reply', reply: { id: MAIN_MENU_IDS.LIST_SERVICES, title: 'Ver servicios' } },
        { type: 'reply', reply: { id: NAV_BACK_MENU, title: 'Menú principal' } },
      ],
    },
  };
}

function datePicker({ tone, body } = {}) {
  const rows = [];
  const now = new Date();
  for (let i = 0; rows.length < 7 && i < 14; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const dow = new Intl.DateTimeFormat('en-US', { timeZone: SPA_TZ, weekday: 'short' }).format(d);
    if (dow === 'Sun') continue;
    const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: SPA_TZ }).format(d);
    const label = new Intl.DateTimeFormat('es-EC', {
      timeZone: SPA_TZ, weekday: 'short', day: 'numeric', month: 'short',
    }).format(d);
    const fullDay = new Intl.DateTimeFormat('es-EC', {
      timeZone: SPA_TZ, weekday: 'long',
    }).format(d);
    rows.push({
      id: `${BOOK_DATE_PREFIX}${isoDate}`,
      title: capitalize(label).slice(0, 24),
      description: capitalize(fullDay).slice(0, 72),
    });
  }
  const defaultBody = tone === 'tu'
    ? '📅 ¿Qué día te queda bien?'
    : '📅 ¿Qué día le queda bien?';
  return {
    type: 'list',
    body: { text: body || defaultBody },
    footer: { text: 'Alma Spa 🌿' },
    action: {
      button: 'Elegir día',
      sections: [{ title: 'Días disponibles', rows }],
    },
  };
}

function _formatSlotTime(isoStr) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: SPA_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(isoStr));
}

function _slotHour(isoStr) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SPA_TZ, hour: 'numeric', hour12: false,
  }).formatToParts(new Date(isoStr));
  const hourPart = parts.find((p) => p.type === 'hour');
  return parseInt(hourPart?.value || '0', 10);
}

function timeSlotList(slots, serviceName, { tone, body } = {}) {
  const morning = [];
  const afternoon = [];
  for (let i = 0; i < slots.length && i < 10; i++) {
    const h = _slotHour(slots[i]);
    const row = {
      id: `${BOOK_TIME_PREFIX}${i}`,
      title: _formatSlotTime(slots[i]),
      description: String(serviceName).slice(0, 72),
    };
    if (h < 13) morning.push(row);
    else afternoon.push(row);
  }

  const sections = [];
  if (morning.length) sections.push({ title: '🌅 Mañana', rows: morning });
  if (afternoon.length) sections.push({ title: '🌆 Tarde', rows: afternoon });
  if (!sections.length && slots.length > 0) {
    sections.push({
      title: 'Horarios',
      rows: slots.slice(0, 10).map((iso, i) => ({
        id: `${BOOK_TIME_PREFIX}${i}`,
        title: _formatSlotTime(iso),
        description: String(serviceName).slice(0, 72),
      })),
    });
  }

  const svcLabel = String(serviceName).slice(0, 50);
  const defaultBody = tone === 'tu'
    ? `🕐 Horarios disponibles para ${svcLabel}:`
    : `🕐 Horarios disponibles para ${svcLabel}:`;
  return {
    type: 'list',
    body: { text: body || defaultBody },
    footer: { text: 'Alma Spa 🌿' },
    action: {
      button: 'Ver horarios',
      sections,
    },
  };
}

function timeSlotButtons(slots, serviceName, { tone } = {}) {
  const svcLabel = String(serviceName).slice(0, 50);
  const buttons = slots.slice(0, 3).map((iso, i) => ({
    type: 'reply',
    reply: {
      id: `${BOOK_TIME_PREFIX}${i}`,
      title: _formatSlotTime(iso),
    },
  }));
  return {
    type: 'button',
    body: { text: tone === 'tu'
      ? `🕐 Horarios para ${svcLabel}:`
      : `🕐 Horarios para ${svcLabel}:` },
    action: { buttons },
  };
}

function bookingConfirmation(summary, { tone } = {}) {
  return {
    type: 'button',
    body: { text: `📋 ¿Confirmo esta cita?\n\n${summary}\n\n${
      tone === 'tu' ? 'Presiona Sí para confirmar 💛' : 'Presione Sí para confirmar 💛'
    }` },
    action: {
      buttons: [
        { type: 'reply', reply: { id: BOOK_CONFIRM_YES, title: 'Sí, confirmar' } },
        { type: 'reply', reply: { id: BOOK_CONFIRM_NO, title: 'No, cancelar' } },
      ],
    },
  };
}

function askNameText({ tone } = {}) {
  return tone === 'tu'
    ? '💛 Para completar tu reserva, ¿me dices tu nombre completo?'
    : '💛 Para completar su reserva, ¿me dice su nombre completo?';
}

module.exports = {
  MAIN_MENU_IDS,
  SERVICE_PREFIX,
  CATEGORY_PREFIX,
  NAV_BACK_MENU,
  BOOK_DATE_PREFIX,
  BOOK_TIME_PREFIX,
  BOOK_CONFIRM_YES,
  BOOK_CONFIRM_NO,
  SPA_TZ,
  CATEGORY_DISPLAY_NAMES,
  HIDDEN_CATEGORIES,
  capitalize,
  categoryDisplayName,
  mainMenu,
  mainMenuText,
  servicesList,
  categoryList,
  servicesInCategory,
  backToMenuButton,
  datePicker,
  timeSlotList,
  timeSlotButtons,
  bookingConfirmation,
  askNameText,
};
