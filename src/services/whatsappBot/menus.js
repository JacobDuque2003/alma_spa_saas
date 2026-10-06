const MAIN_MENU_IDS = {
  LIST_SERVICES: 'menu_list_services',
  BOOK: 'menu_book',
  BOOK_FOR_OTHER: 'menu_book_for_other',
  RECOMMEND: 'menu_recommend_service',
  PROMOTIONS: 'menu_promotions',
  MY_APPOINTMENT: 'menu_my_appointment',
  ESCALATE: 'menu_escalate',
};

const SERVICE_PREFIX = 'svc_';
const SERVICE_PAGE_PREFIX = 'svc_page_';
const BOOK_SERVICE_PREFIX = 'book_svc_';
const CATEGORY_PREFIX = 'cat_';
const NAV_BACK_MENU = 'nav_menu';
// Este identificador vuelve siempre al menú principal. NAV_BACK_MENU se
// conserva para retroceder dentro de una reserva o una reprogramación.
const MAIN_MENU_BACK = 'nav_main_menu';
const BOOK_DATE_PREFIX = 'bkd_';
const BOOK_TIME_PREFIX = 'bkt_';
const BOOK_TIME_PAGE_PREFIX = 'bkt_page_';
const BOOK_STAFF_PREFIX = 'bkstaff_';
const BOOK_STAFF_ANY = 'bkstaff_any';
const BOOK_PERIOD_MORNING = 'bkp_morning';
const BOOK_PERIOD_AFTERNOON = 'bkp_afternoon';
const BOOK_CONFIRM_YES = 'bk_yes';
const BOOK_CONFIRM_NO = 'bk_no';
const BOOK_RECIPIENT_SELF = 'bk_recipient_self';
const BOOK_RECIPIENT_OTHER = 'bk_recipient_other';
const RESCHEDULE_START = 'reschedule_start';
const RESCHEDULE_APPOINTMENT_PREFIX = 'rs_appt_';
const RESCHEDULE_CONFIRM_YES = 'rs_yes';
const RESCHEDULE_CONFIRM_NO = 'rs_no';
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
  return tone === 'tu' ? '¿Cómo te puedo ayudar hoy?' : '¿En qué le puedo ayudar?';
}

function mainMenuText({ tone, clientName, compact = false } = {}) {
  const instruction = tone === 'tu' ? 'Escríbeme qué te gustaría hacer:' : 'Escríbame qué le gustaría hacer:';
  const intro = compact
    ? (tone === 'tu' ? '🌿 ¿Qué te gustaría hacer hoy?' : '🌿 ¿Qué le gustaría explorar ahora?')
    : `${greeting(tone, clientName)}\n${verbYouCan(tone)}`;
  return `${intro}

${instruction}
🌿 Ver servicios
📅 Reservar cita
👤 Reservar para otra persona
✨ No sé qué elegir
🌸 Promociones y catálogo
📋 Consultar mi cita
💬 Hablar con recepción`;
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
  MAIN_MENU_BACK,
  BOOK_DATE_PREFIX,
  BOOK_TIME_PREFIX,
  BOOK_TIME_PAGE_PREFIX,
  BOOK_STAFF_PREFIX,
  BOOK_STAFF_ANY,
  BOOK_PERIOD_MORNING,
  BOOK_PERIOD_AFTERNOON,
  BOOK_CONFIRM_YES,
  BOOK_CONFIRM_NO,
  BOOK_RECIPIENT_SELF,
  BOOK_RECIPIENT_OTHER,
  RESCHEDULE_START,
  RESCHEDULE_APPOINTMENT_PREFIX,
  RESCHEDULE_CONFIRM_YES,
  RESCHEDULE_CONFIRM_NO,
  SPA_TZ,
  CATEGORY_DISPLAY_NAMES,
  HIDDEN_CATEGORIES,
  capitalize,
  firstName,
  serviceEmoji,
  categoryDisplayName,
  mainMenuText,
  bookingConfirmation,
  rescheduleConfirmation,
  askNameText,
};
