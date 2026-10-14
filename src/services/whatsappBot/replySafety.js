function formatWhatsapp(value) {
  return String(value || '').replace(/\*\*([^*]+)\*\*/g, '*$1*').replace(/__([^_]+)__/g, '_$1_')
    .replace(/^\s*#{1,6}\s+/gm, '').replace(/^\s*\*\s+/gm, '- ').replace(/\0/g, '').trim();
}
function guardReply(value) {
  const formatted = formatWhatsapp(value);
  const withoutNegations = formatted.replace(/\b(?:no|nunca|sin)\s+(?:(?:se|he|hemos|esta|está|ha|hay|haber|han)\s+){0,3}(?:reservad[oa]|confirmad[oa]|agendad[oa]|cancelad[oa]|reprogramad[oa]|pago recibido)\b/gi, '');
  if (/\b(reservad[oa]|confirmad[oa]|agendad[oa]|cancelad[oa]|reprogramad[oa]|pago recibido)\b/i.test(withoutNegations)) {
    return 'No he realizado cambios ni registrado pagos. Necesito verificar los datos de la gestión; también puede ayudarle un asesor.';
  }
  return formatted;
}
module.exports = { formatWhatsapp, guardReply };
