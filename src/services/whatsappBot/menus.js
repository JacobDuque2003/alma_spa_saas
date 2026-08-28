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
      sections.push({ title: cat.slice(0, 24), rows });
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

// Category picker — used when >10 active services. Each row is a category
// that leads to a second list with the services in that category.
function categoryList(categories, { tone, body } = {}) {
  const rows = categories.slice(0, 10).map((c) => ({
    id: `${CATEGORY_PREFIX}${c.name}`,
    title: String(c.name).slice(0, 24),
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

// Services within a single category (max 10 rows, safe for Meta).
function servicesInCategory(services, categoryName, { tone } = {}) {
  const rows = services.slice(0, 10).map((s) => ({
    id: `${SERVICE_PREFIX}${s.id}`,
    title: String(s.name).slice(0, 24),
    description: `$${Number(s.priceUsd).toFixed(2)} · ${s.durationMins || 60} min`.slice(0, 72),
  }));
  const label = String(categoryName).slice(0, 30);
  return {
    type: 'list',
    body: { text: tone === 'tu'
      ? `✨ Servicios de ${label}. Toca uno para ver más:`
      : `✨ Servicios de ${label}. Toque uno para ver más:` },
    footer: { text: 'Alma Spa 🌿' },
    action: {
      button: 'Ver servicios',
      sections: [{ title: String(categoryName).slice(0, 24), rows }],
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

function datePicker({ tone } = {}) {
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
  return {
    type: 'list',
    body: { text: tone === 'tu'
      ? '📅 ¿Qué día te queda bien?'
      : '📅 ¿Qué día le queda bien?' },
    footer: { text: 'Alma Spa 🌿' },
    action: {
      button: 'Elegir día',
      sections: [{ title: 'Días disponibles', rows }],
    },
  };
}

function timeSlotList(slots, serviceName, { tone } = {}) {
  const rows = slots.slice(0, 10).map((isoStr, i) => {
    const d = new Date(isoStr);
    const time = new Intl.DateTimeFormat('es-EC', {
      timeZone: SPA_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
    return {
      id: `${BOOK_TIME_PREFIX}${i}`,
      title: time,
      description: String(serviceName).slice(0, 72),
    };
  });
  const svcLabel = String(serviceName).slice(0, 50);
  return {
    type: 'list',
    body: { text: tone === 'tu'
      ? `🕐 Horarios disponibles para ${svcLabel}:`
      : `🕐 Horarios disponibles para ${svcLabel}:` },
    footer: { text: 'Alma Spa 🌿' },
    action: {
      button: 'Ver horarios',
      sections: [{ title: 'Horarios', rows }],
    },
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
  capitalize,
  mainMenu,
  mainMenuText,
  servicesList,
  categoryList,
  servicesInCategory,
  backToMenuButton,
  datePicker,
  timeSlotList,
  bookingConfirmation,
  askNameText,
};
