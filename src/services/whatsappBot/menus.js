// Constructores de payloads WhatsApp "interactive" para el bot.
// Los ids de rows son consumidos por handleInboundMessage cuando la clienta
// selecciona una opción — sirven como enum determinístico.

const MAIN_MENU_IDS = {
  LIST_SERVICES: 'menu_list_services',
  BOOK: 'menu_book',
  MY_APPOINTMENT: 'menu_my_appointment',
  ESCALATE: 'menu_escalate',
};

const SERVICE_PREFIX = 'svc_';   // svc_<serviceId>
const NAV_BACK_MENU = 'nav_menu';

// Ver conversation.tone en state.js — "usted" default, "tú" si la clienta
// usó "tú"/"tu" en su mensaje libre. Solo afecta el copy del bot.
function greeting(tone) {
  return tone === 'tu'
    ? '¡Hola! Soy el asistente de Alma Spa 🌿'
    : '¡Hola! Soy el asistente de Alma Spa 🌿';
}

function verbYouCan(tone) {
  return tone === 'tu' ? '¿Con qué te puedo ayudar hoy?' : '¿En qué le puedo ayudar hoy?';
}

// Menú principal — list message porque son 4 opciones (reply buttons solo
// permite 3).
function mainMenu({ tone } = {}) {
  return {
    type: 'list',
    body: { text: `${greeting(tone)}\n${verbYouCan(tone)}` },
    footer: { text: 'Elige una opción del menú' },
    action: {
      button: 'Ver opciones',
      sections: [
        {
          title: 'Menú',
          rows: [
            { id: MAIN_MENU_IDS.LIST_SERVICES, title: 'Ver servicios', description: 'Nuestra oferta con fotos y precios' },
            { id: MAIN_MENU_IDS.BOOK, title: 'Reservar cita', description: 'Reserva por la web' },
            { id: MAIN_MENU_IDS.MY_APPOINTMENT, title: 'Mi cita', description: 'Consultar mi próxima cita' },
            { id: MAIN_MENU_IDS.ESCALATE, title: 'Hablar con recepción', description: 'Un miembro del equipo te contactará' },
          ],
        },
      ],
    },
  };
}

// Menú de servicios — agrupados por categoría en secciones (máximo 10
// secciones y 10 rows por sección). Cada row es un servicio activo con
// precio como description. Al seleccionar, el bot envía imagen+descripción.
function servicesList(services, { tone } = {}) {
  // Agrupar por categoría, respetando el orden alfabético dentro y entre.
  const byCat = new Map();
  for (const s of services) {
    if (!s.active) continue;
    const cat = String(s.category || 'otros');
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(s);
  }
  const sections = [];
  for (const [cat, items] of [...byCat.entries()].sort()) {
    const rows = items
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .slice(0, 10)
      .map((s) => ({
        id: `${SERVICE_PREFIX}${s.id}`,
        title: String(s.name).slice(0, 24),
        description: `$${Number(s.priceUsd).toFixed(2)} · ${s.durationMins || 60} min`.slice(0, 72),
      }));
    if (rows.length) sections.push({ title: cat.slice(0, 24), rows });
  }
  // Meta permite máximo 10 secciones.
  const sectionsCapped = sections.slice(0, 10);

  return {
    type: 'list',
    body: { text: tone === 'tu' ? 'Elige un servicio para ver el detalle:' : 'Elija un servicio para ver el detalle:' },
    footer: { text: 'Toca para ver la descripción y foto' },
    action: {
      button: 'Ver servicios',
      sections: sectionsCapped,
    },
  };
}

// "Volver al menú" como reply button, tras enviar el detalle de un servicio.
function backToMenuButton({ tone } = {}) {
  return {
    type: 'button',
    body: { text: tone === 'tu' ? '¿Algo más te puedo mostrar?' : '¿Algo más le puedo mostrar?' },
    action: {
      buttons: [
        { type: 'reply', reply: { id: NAV_BACK_MENU, title: 'Ver menú' } },
      ],
    },
  };
}

module.exports = {
  MAIN_MENU_IDS,
  SERVICE_PREFIX,
  NAV_BACK_MENU,
  mainMenu,
  servicesList,
  backToMenuButton,
};
