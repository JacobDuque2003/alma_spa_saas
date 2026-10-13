function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const HIDDEN_CATEGORIES = ['tienda', 'recordatorio', 'valoracion', 'interno'];
const HIDDEN_NAMES = ['cumpleanos', 'valoracion'];

function isCustomerService(service) {
  return !!service && service.active !== false
    && !HIDDEN_CATEGORIES.includes(normalize(service.category))
    && !HIDDEN_NAMES.includes(normalize(service.name));
}

function customerServiceWhere(tenantId) {
  return { tenantId, active: true, NOT: [
    ...HIDDEN_CATEGORIES.map((category) => ({ category: { equals: category, mode: 'insensitive' } })),
    ...['Cumpleanos', 'Cumpleaños', 'Valoracion', 'Valoración'].map((name) => ({ name: { equals: name, mode: 'insensitive' } })),
  ] };
}

function hasConfirmedPrice(service) {
  const price = Number(service?.priceUsd);
  return Number.isFinite(price) && price > 0;
}

function formatCustomerPrice(priceUsd) {
  return hasConfirmedPrice({ priceUsd }) ? `$${Number(priceUsd).toFixed(2)}` : 'Valor a confirmar';
}

module.exports = { isCustomerService, customerServiceWhere, hasConfirmedPrice, formatCustomerPrice };
