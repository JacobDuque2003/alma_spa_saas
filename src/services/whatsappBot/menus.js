const MAIN_MENU_IDS = {
  LIST_SERVICES: 'menu_list_services',
  BOOK: 'menu_book',
  RECOMMEND: 'menu_recommend_service',
  MY_APPOINTMENT: 'menu_my_appointment',
  ESCALATE: 'menu_escalate',
};

const SERVICE_PREFIX = 'svc_';
const SERVICE_PAGE_PREFIX = 'svc_page_';
const BOOK_SERVICE_PREFIX = 'book_svc_';
const CATEGORY_PREFIX = 'cat_';
const NAV_BACK_MENU = 'nav_menu';
const BOOK_DATE_PREFIX = 'bkd_';
const BOOK_TIME_PREFIX = 'bkt_';
const BOOK_TIME_PAGE_PREFIX = 'bkt_page_';
const BOOK_PERIOD_MORNING = 'bkp_morning';
const BOOK_PERIOD_AFTERNOON = 'bkp_afternoon';
const BOOK_CONFIRM_YES = 'bk_yes';
const BOOK_CONFIRM_NO = 'bk_no';
const RESCHEDULE_START = 'reschedule_start';
const RESCHEDULE_CONFIRM_YES = 'rs_yes';
const RESCHEDULE_CONFIRM_NO = 'rs_no';
const SPA_TZ = 'America/Guayaquil';
const LIST_PAGE_SIZE = 7;

const CATEGORY_DISPLAY_NAMES = {
  corporal: '\u{1F486}‍♀️ Cuerpo y Relajación',
  facial: '✨ Tratamientos Faciales',
  terapias: '\u{1F33F} Terapias Holísticas',
  laser: '⚡ Depilación Láser',
  ceragem: '\u{1F6CF}️ Camilla Ceragem',
  yoga: '\u{1F9D8} Aero Yoga',
  pies: '\u{1F9B6} Cuidado de Pies',
};

const HIDDEN_CATEGORIES = new Set(['tienda', 'recordatorio', 'valoracion']);

function categoryDisplayName(raw) {
  const key = String(raw).toLowerCase().trim();
  return CATEGORY_DISPLAY_NAMES[key] || capitalize(raw);
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || null;
}

function greeting(tone, clientName) {
  const name = firstName(clientName);
  const hello = name ? `¡Hola, ${name}!` : '¡Hola!';
  return tone === 'tu'
    ? `✨ *${hello} Soy Almita, tu asistente en Alma Spa*`
    : `✨ *${hello} Soy Almita, su asistente en Alma Spa*`;
}

function verbYouCan(tone) {
  return tone === 'tu' ? '¿En qué te puedo ayudar?' : '¿En qué le puedo ayudar?';
}

function mainMenu({ tone, clientName, compact = false } = {}) {
  const body = compact
    ? (tone === 'tu' ? '🌿 ¿Qué te gustaría explorar ahora?' : '🌿 ¿Qué le gustaría explorar ahora?')
    : `${greeting(tone, clientName)}\n${verbYouCan(tone)}`;
  return {
    type: 'list',
    body: { text: body },
    footer: { text: 'Alma Spa · Zamora 🌿' },
    action: {
      button: 'Ver opciones',
      sections: [
        {
          title: 'Menú',
          rows: [
            { id: MAIN_MENU_IDS.LIST_SERVICES, title: 'Ver servicios', description: '💆‍♀️ Nuestra carta con precios' },
            { id: MAIN_MENU_IDS.BOOK, title: 'Reservar cita', description: '📅 Agenda tu hora por la web' },
            { id: MAIN_MENU_IDS.RECOMMEND, title: 'No sé qué elegir', description: '✨ Cuéntame qué estás buscando' },
            { id: MAIN_MENU_IDS.MY_APPOINTMENT, title: 'Mi cita', description: '📋 Consulta tu próxima cita' },
            { id: MAIN_MENU_IDS.ESCALATE, title: 'Hablar con recepción', description: '👋 Te conectamos con el equipo' },
          ],
        },
      ],
    },
  };
}

function mainMenuText({ tone, clientName, compact = false } = {}) {
  const instruction = tone === 'tu' ? 'Responde con una opción:' : 'Responda con una opción:';
  const intro = compact
    ? (tone === 'tu' ? '🌿 ¿Qué te gustaría explorar ahora?' : '🌿 ¿Qué le gustaría explorar ahora?')
    : `${greeting(tone, clientName)}\n${verbYouCan(tone)}`;
  return `${intro}

${instruction}
1. Ver servicios
2. Reservar cita
3. No sé qué elegir
4. Consultar mi cita
5. Hablar con recepción`;
}

function serviceEmoji(service) {
  const name = String(service?.name || '').toLowerCase();
  const category = String(service?.category || '').toLowerCase();
  if (name.includes('aero yoga') || category === 'yoga') return '🧘';
  if (name.includes('ceragem') || category === 'ceragem') return '🛏️';
  if (name.includes('depil')) return '⚡';
  if (name.includes('drenaje')) return '💧';
  if (name.includes('masaje')) return '💆';
  if (name.includes('facial') || category === 'facial') return '✨';
  if (name.includes('reflex') || name.includes('detox') || category === 'pies') return '🦶';
  if (name.includes('sueroterapia')) return '🩺';
  if (name.includes('neural')) return '🩺';
  if (name.includes('energ')) return '🌿';
  if (category === 'corporal') return '🌸';
  if (category === 'terapias') return '🌿';
  return '🌿';
}

// Meta permite un máximo de 10 filas por lista. Siete opciones por página
// dejan espacio para avanzar, retroceder y volver al menú sin superar el límite.
function servicesList(services, { tone, body, page = 0 } = {}) {
  const visible = services.filter((service) => service.active !== false)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const safePage = Math.max(0, Math.min(Number(page) || 0, Math.max(Math.ceil(visible.length / LIST_PAGE_SIZE) - 1, 0)));
  const start = safePage * LIST_PAGE_SIZE;
  const rows = visible.slice(start, start + LIST_PAGE_SIZE).map((service) => ({
    id: `${SERVICE_PREFIX}${service.id}`,
    title: `${serviceEmoji(service)} ${String(service.name)}`.slice(0, 24),
    description: `$${Number(service.priceUsd).toFixed(2)} · ${service.durationMins || 60} min`.slice(0, 72),
  }));
  if (start + LIST_PAGE_SIZE < visible.length) {
    rows.push({
      id: `${SERVICE_PAGE_PREFIX}${safePage + 1}`,
      title: 'Ver más servicios',
      description: `${visible.length - (start + LIST_PAGE_SIZE)} servicios más`,
    });
  }
  if (safePage > 0) {
    rows.push({
      id: `${SERVICE_PAGE_PREFIX}${safePage - 1}`,
      title: 'Volver a servicios anteriores',
      description: 'Regresar a la página anterior',
    });
  }
  rows.push({ id: NAV_BACK_MENU, title: 'Volver al menú', description: 'Regresar a las opciones principales' });

  const defaultBody = tone === 'tu'
    ? '🌿 *Nuestros servicios* — toca uno para ver más'
    : '🌿 *Nuestros servicios* — toque uno para ver más';
  return {
    type: 'list',
    body: { text: body || defaultBody },
    footer: { text: 'Alma Spa 🌿' },
    action: {
      button: 'Ver servicios',
      sections: [{ title: 'Servicios', rows }],
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
    ? '🌿 *Nuestros servicios* — elige una categoría'
    : '🌿 *Nuestros servicios* — elija una categoría';
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
      ? `*${label}* — toca uno para ver más`
      : `*${label}* — toque uno para ver más` },
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
        { type: 'reply', reply: { id: MAIN_MENU_IDS.LIST_SERVICES, title: 'Volver a servicios' } },
        { type: 'reply', reply: { id: NAV_BACK_MENU, title: 'Menú principal' } },
      ],
    },
  };
}

function serviceDetailActions(service, { tone } = {}) {
  return {
    type: 'button',
    body: { text: tone === 'tu' ? '¿Quieres apartar este servicio? 💛' : '¿Desea apartar este servicio? 💛' },
    action: {
      buttons: [
        { type: 'reply', reply: { id: `${BOOK_SERVICE_PREFIX}${service.id}`, title: '📅 Reservar cita' } },
        { type: 'reply', reply: { id: MAIN_MENU_IDS.LIST_SERVICES, title: '💆 Ver servicios' } },
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
      sections: [{ title: 'Días disponibles', rows: [...rows, { id: NAV_BACK_MENU, title: 'Volver', description: 'Elegir otro servicio' }] }],
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

function timeSlotList(slots, serviceName, { tone, body, page = 0 } = {}) {
  const safePage = Math.max(0, Math.min(Number(page) || 0, Math.max(Math.ceil(slots.length / LIST_PAGE_SIZE) - 1, 0)));
  const start = safePage * LIST_PAGE_SIZE;
  const pageSlots = slots.slice(start, start + LIST_PAGE_SIZE);
  const morning = [];
  const afternoon = [];
  for (let i = 0; i < pageSlots.length; i++) {
    const actualIndex = start + i;
    const h = _slotHour(pageSlots[i]);
    const row = {
      id: `${BOOK_TIME_PREFIX}${actualIndex}`,
      title: _formatSlotTime(pageSlots[i]),
      description: String(serviceName).slice(0, 72),
    };
    if (h < 13) morning.push(row);
    else afternoon.push(row);
  }

  const sections = [];
  if (morning.length) sections.push({ title: '🌅 Mañana', rows: morning });
  if (afternoon.length) sections.push({ title: '🌆 Tarde', rows: afternoon });
  if (!sections.length && pageSlots.length > 0) {
    sections.push({
      title: 'Horarios',
      rows: pageSlots.map((iso, i) => ({
        id: `${BOOK_TIME_PREFIX}${start + i}`,
        title: _formatSlotTime(iso),
        description: String(serviceName).slice(0, 72),
      })),
    });
  }
  if (sections.length) {
    const target = sections[sections.length - 1];
    if (start + LIST_PAGE_SIZE < slots.length) {
      target.rows.push({ id: `${BOOK_TIME_PAGE_PREFIX}${safePage + 1}`, title: 'Ver más horarios', description: 'Mostrar los siguientes horarios' });
    }
    if (safePage > 0) {
      target.rows.push({ id: `${BOOK_TIME_PAGE_PREFIX}${safePage - 1}`, title: 'Volver a horarios anteriores', description: 'Regresar a la página anterior' });
    }
    target.rows.push({ id: NAV_BACK_MENU, title: 'Volver', description: 'Elegir otro día o servicio' });
  }

  const svcLabel = String(serviceName).slice(0, 50);
  const defaultBody = `🕐 *Horarios para* _${svcLabel}_`;
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

function timePeriodPicker({ tone } = {}) {
  return {
    type: 'button',
    body: { text: tone === 'tu' ? '🕐 ¿Qué momento te queda mejor?' : '🕐 ¿Qué momento le queda mejor?' },
    action: {
      buttons: [
        { type: 'reply', reply: { id: BOOK_PERIOD_MORNING, title: '🌅 Mañana' } },
        { type: 'reply', reply: { id: BOOK_PERIOD_AFTERNOON, title: '🌆 Tarde' } },
        { type: 'reply', reply: { id: NAV_BACK_MENU, title: 'Volver' } },
      ],
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
    body: { text: `🕐 *Horarios para* _${svcLabel}_` },
    action: { buttons },
  };
}

function bookingConfirmation(summary, { tone } = {}) {
  const header = tone === 'tu' ? '✨ *¿Confirmo tu espacio?*' : '✨ *¿Confirmo su espacio?*';
  return {
    type: 'button',
    body: { text: `${header}\n\n${summary}\n\n${
      tone === 'tu' ? 'Presiona *Sí* para confirmar 💛' : 'Presione *Sí* para confirmar 💛'
    }` },
    action: {
      buttons: [
        { type: 'reply', reply: { id: BOOK_CONFIRM_YES, title: 'Sí, confirmar' } },
        { type: 'reply', reply: { id: BOOK_CONFIRM_NO, title: 'No, cancelar' } },
      ],
    },
  };
}

function appointmentActions({ tone } = {}) {
  return {
    type: 'button',
    body: { text: tone === 'tu' ? '¿Quieres cambiar el día u hora de tu espacio?' : '¿Desea cambiar el día u hora de su espacio?' },
    action: {
      buttons: [
        { type: 'reply', reply: { id: RESCHEDULE_START, title: 'Reprogramar cita' } },
        { type: 'reply', reply: { id: NAV_BACK_MENU, title: 'Menú principal' } },
      ],
    },
  };
}

function rescheduleConfirmation(summary, { tone } = {}) {
  const header = tone === 'tu' ? '✨ *¿Actualizo tu espacio?*' : '✨ *¿Actualizo su espacio?*';
  return {
    type: 'button',
    body: { text: `${header}\n\n${summary}\n\n${tone === 'tu' ? 'Presiona *Sí* para confirmar 💛' : 'Presione *Sí* para confirmar 💛'}` },
    action: {
      buttons: [
        { type: 'reply', reply: { id: RESCHEDULE_CONFIRM_YES, title: 'Sí, actualizar' } },
        { type: 'reply', reply: { id: RESCHEDULE_CONFIRM_NO, title: 'No, dejar igual' } },
      ],
    },
  };
}

function askNameText({ tone } = {}) {
  return tone === 'tu'
    ? '💛 *Para apartar tu espacio*, ¿me dices tu nombre completo?'
    : '💛 *Para apartar su espacio*, ¿me dice su nombre completo?';
}

module.exports = {
  MAIN_MENU_IDS,
  SERVICE_PREFIX,
  SERVICE_PAGE_PREFIX,
  BOOK_SERVICE_PREFIX,
  CATEGORY_PREFIX,
  NAV_BACK_MENU,
  BOOK_DATE_PREFIX,
  BOOK_TIME_PREFIX,
  BOOK_TIME_PAGE_PREFIX,
  BOOK_PERIOD_MORNING,
  BOOK_PERIOD_AFTERNOON,
  BOOK_CONFIRM_YES,
  BOOK_CONFIRM_NO,
  RESCHEDULE_START,
  RESCHEDULE_CONFIRM_YES,
  RESCHEDULE_CONFIRM_NO,
  SPA_TZ,
  LIST_PAGE_SIZE,
  CATEGORY_DISPLAY_NAMES,
  HIDDEN_CATEGORIES,
  capitalize,
  firstName,
  serviceEmoji,
  categoryDisplayName,
  mainMenu,
  mainMenuText,
  servicesList,
  categoryList,
  servicesInCategory,
  backToMenuButton,
  serviceDetailActions,
  datePicker,
  timeSlotList,
  timePeriodPicker,
  timeSlotButtons,
  bookingConfirmation,
  appointmentActions,
  rescheduleConfirmation,
  askNameText,
};
