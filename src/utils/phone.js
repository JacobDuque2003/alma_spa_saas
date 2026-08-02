/**
 * Normaliza un número de teléfono a formato E.164 con +:
 *   - Strip espacios, guiones, paréntesis.
 *   - Detecta convenciones locales de Ecuador (código país 593) y las
 *     convierte a internacional: la dueña escribe "0993..." o "993..."
 *     y ambos terminan como "+593993...".
 *   - Cualquier otro formato conserva el comportamiento previo (strip
 *     + prefijar +), útil para números fuera de Ecuador que ya vengan
 *     en internacional.
 *
 * La DB almacena +593..., la API de WhatsApp usa 593... (sin +).
 * Ambos lados pasan por aquí.
 */
function normalizePhone(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/[^0-9+]/g, '');

  // Ya viene en E.164
  if (digits.startsWith('+')) return digits;

  // Ecuador: 10 dígitos que empiezan con 0 → celular local ("0993629257")
  if (/^0\d{9}$/.test(digits)) return '+593' + digits.slice(1);

  // Ecuador: 9 dígitos que empiezan con 9 → celular sin código país ("993629257")
  if (/^9\d{8}$/.test(digits)) return '+593' + digits;

  // Ya trae código país sin + ("593993629257")
  if (/^593\d{9}$/.test(digits)) return '+' + digits;

  // Fallback: prefija + sin adivinar el país. Valida E.164 aguas abajo.
  return '+' + digits;
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
