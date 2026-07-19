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

/**
 * Valida que un string ya normalizado sea un número E.164 razonable:
 * empieza con +, seguido de 7-15 dígitos (ITU-T E.164 max = 15 dígitos).
 */
const E164_RE = /^\+[1-9]\d{6,14}$/;
function isValidE164(phone) {
  return E164_RE.test(phone);
}

function phoneToWaId(phone) {
  return normalizePhone(phone).replace(/^\+/, '');
}

function waIdToPhone(waId) {
  return '+' + String(waId).replace(/[^0-9]/g, '');
}

module.exports = { normalizePhone, isValidE164, phoneToWaId, waIdToPhone };
