/**
 * Normaliza un número de teléfono a formato E.164 con +: strip espacios,
 * guiones, paréntesis; asegurar prefijo +. La DB almacena +593..., la API
 * de WhatsApp usa 593... (sin +). Ambos lados pasan por aquí.
 */
function normalizePhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/[^0-9+]/g, '');
  return digits.startsWith('+') ? digits : '+' + digits;
}

function phoneToWaId(phone) {
  return normalizePhone(phone).replace(/^\+/, '');
}

function waIdToPhone(waId) {
  return '+' + String(waId).replace(/[^0-9]/g, '');
}

module.exports = { normalizePhone, phoneToWaId, waIdToPhone };
