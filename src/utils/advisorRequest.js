function isReceptionRequest(text) {
  const t = String(text || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\b(gianella|gianela|giannella)\b/.test(t)) return true;
  if (/^(4|humano|humana|asesor|asesora|agente|persona|alguien|recepcion|recepcionista)$/.test(t)) return true;
  const person = '(persona|humano|humana|asesor(?:a)?|agente|recepcion(?:ista)?|alguien|equipo)';
  return new RegExp(`\\b(hablar|contactar|contacto|comunicar|conectar|pasar|atender|atencion|quiero|quisiera|deseo|necesito|prefiero)\\b[^.!?]{0,80}\\b${person}\\b`).test(t)
    || new RegExp(`\\b${person}\\b[^.!?]{0,80}\\b(por favor|ahora|real|de verdad)\\b`).test(t);
}

module.exports = { isReceptionRequest };
