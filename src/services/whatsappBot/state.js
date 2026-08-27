// Estado en memoria del bot por conversación. Piloto de una sola instancia
// (mismo patrón que auth-rate-limit y accessSchedule-audit-throttle). Un
// reinicio del proceso pierde el estado — el próximo mensaje reinicia en el
// menú principal, lo cual es aceptable para la Fase 1 sin migración.
//
// Dos mapas independientes:
//  - flowState: qué sub-flujo está activo (menú, viendo servicios, etc.) y
//    contexto pequeño (ej. tono "usted"/"tú" detectado en la conversación).
//    TTL 1h — si la clienta reaparece al día siguiente, el bot manda menú
//    otra vez, no arrastra estado viejo.
//  - escalated: números que pidieron hablar con recepción. TTL 24h. El bot
//    no responde a esas conversaciones durante ese tiempo.

const FLOW_TTL_MS = 60 * 60 * 1000;        // 1h
const ESCALATED_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_HISTORY = 10;

const flowState = new Map();  // customerWaId -> { flow, tone, updatedAt }
const escalated = new Map();  // customerWaId -> expiresAt

function _now() { return Date.now(); }

function _sweep(map, keyToRemove) {
  const now = _now();
  for (const [k, v] of map) {
    const exp = typeof v === 'number' ? v : (v?.updatedAt || 0) + FLOW_TTL_MS;
    if (exp <= now) map.delete(k);
  }
  if (keyToRemove) map.delete(keyToRemove);
}

function getFlowState(waId) {
  const v = flowState.get(waId);
  if (!v) return null;
  if (_now() - v.updatedAt > FLOW_TTL_MS) {
    flowState.delete(waId);
    return null;
  }
  return v;
}

function setFlowState(waId, partial) {
  const prev = flowState.get(waId) || {};
  const next = { ...prev, ...partial, updatedAt: _now() };
  flowState.set(waId, next);
  if (flowState.size > 1000) _sweep(flowState);
  return next;
}

function clearFlowState(waId) {
  flowState.delete(waId);
}

function markEscalated(waId) {
  escalated.set(waId, _now() + ESCALATED_TTL_MS);
  if (escalated.size > 5000) _sweep(escalated);
}

function isEscalated(waId) {
  const exp = escalated.get(waId);
  if (!exp) return false;
  if (exp <= _now()) {
    escalated.delete(waId);
    return false;
  }
  return true;
}

function pushHistory(waId, role, content) {
  const s = getFlowState(waId) || {};
  const history = Array.isArray(s.history) ? [...s.history] : [];
  history.push({ role, content: String(content).slice(0, 300) });
  while (history.length > MAX_HISTORY) history.shift();
  setFlowState(waId, { history });
}

function getHistory(waId) {
  const s = getFlowState(waId);
  return s?.history || [];
}

module.exports = {
  getFlowState,
  setFlowState,
  clearFlowState,
  pushHistory,
  getHistory,
  markEscalated,
  isEscalated,
  _reset: () => { flowState.clear(); escalated.clear(); },
  FLOW_TTL_MS,
  ESCALATED_TTL_MS,
  MAX_HISTORY,
};
