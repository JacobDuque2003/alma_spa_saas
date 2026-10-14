const appointmentService = require('../appointmentService');
const { normalizeText } = require('./textNormalize');
const { hasConfirmedPrice, formatCustomerPrice } = require('../../utils/customerServicePolicy');
const { formatSchedule } = require('../../utils/businessHours');

const canonical = (text) => normalizeText(text).split(' ').map((word) => word.length > 4 ? word.replace(/s$/, '') : word).join(' ');
async function readOnlyReply({ tenantId, tenantConfig, services, knowledge, message, history = [] }) {
  const query = canonical(message);
  const matching = services.filter((service) => query.includes(canonical(service.name)));
  const source = matching.length ? matching : history.filter((row) => row.role === 'user').reverse()
    .map((row) => services.filter((service) => canonical(row.content).includes(canonical(service.name)))).find((rows) => rows.length) || [];
  const service = source.length === 1 ? source[0] : null;
  const missingService = knowledge.find((row) => query.includes(canonical(row.title)) && !services.some((service) => canonical(service.name) === canonical(row.title))
    && !/ubicacion|politica|horario/.test(normalizeText(row.category)));
  if (missingService) return { intent: 'service_info', reply: `${missingService.title}\n\n${missingService.content}\n\nUn asesor puede coordinar este servicio; no lo sustituiré por otro tratamiento.` };
  if (!service) return null;
  const parsers = require('./index')._internals;
  const date = parsers.resolveBookingDate({}, normalizeText(message, { preserveDatePunctuation: true }));
  const asksSlots = /\b(disponible|disponibles|horarios|espacios|fechas)\b/.test(query);
  if (!date && !asksSlots) return null;
  if (!hasConfirmedPrice(service)) return { intent: 'escalate', reply: `${service.name}: valor a confirmar con un asesor.` };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date());
  let chosenDate = date || today;
  if (chosenDate < today) return { intent: 'book_service', reply: 'Esa fecha ya pasó. Elija un día de atención futuro.' };
  for (let offset = 0; offset < 14; offset++) {
    const localDay = new Date(`${chosenDate}T12:00:00Z`).getUTCDay() || 7;
    if (Array.isArray(tenantConfig?.workDays) && !tenantConfig.workDays.map((day) => day || 7).includes(localDay)) {
      if (date && offset === 0) return { intent: 'business_hours', reply: `Ese día no hay atención. ${formatSchedule(tenantConfig)}` };
    } else {
      const slots = await appointmentService.getAvailability({ tenantId, tenantConfig, serviceId: service.id, date: chosenDate, modality: 'spa', publicOnly: true });
      if (slots.length) {
        const times = slots.slice(0, 10).map((slot) => new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(slot)));
        return { intent: 'book_service', params: { service_query: service.name, date_text: chosenDate },
          reply: `${service.name}: ${formatCustomerPrice(service.priceUsd)}, ${service.durationMins} min.\nDisponibilidad real para ${chosenDate}: ${times.join(', ')}.\nEn esta simulación no se crean citas.` };
      }
    }
    const next = new Date(`${chosenDate}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); chosenDate = next.toISOString().slice(0, 10);
  }
  return { intent: 'book_service', reply: 'No encontré horarios disponibles en los próximos días para este servicio. Un asesor puede ayudarle.' };
}
module.exports = { readOnlyReply };
