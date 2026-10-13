// Estado activo del bot por conversación. Vive en memoria para responder rápido
// y se hidrata/persiste desde WhatsAppConversation.botState al recibir mensajes,
// de modo que un reinicio del proceso no corta una reserva a medio camino.
//
// Dos mapas independientes:
//  - flowState: qué sub-flujo está activo (menú, viendo servicios, etc.) y
//    contexto pequeño (ej. tono "usted"/"tú" detectado en la conversación).
//    TTL 1h — si la clienta reaparece al día siguiente, el bot manda menú
//    otra vez, no arrastra estado viejo.
//  - escalated: números que pidieron hablar con recepción. TTL 24h. El bot
//    no responde a esas conversaciones durante ese tiempo.

const { AsyncLocalStorage } = require('node:async_hooks');

const conversationScope = new AsyncLocalStorage();
const FLOW_TTL_MS = 60 * 60 * 1000;        // 1h
const ESCALATED_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_HISTORY = 10;

const flowState = new Map();  // [namespace, customerWaId] -> { flow, tone, updatedAt }
const escalated = new Map();  // [namespace, customerWaId] -> expiresAt

function withConversation(tenantId, conversationId, callback) {
  if (typeof tenantId !== 'string' || !tenantId.trim()
    || typeof conversationId !== 'string' || !conversationId.trim()) {
    throw new TypeError('tenantId and conversationId are required');
  }
  return conversationScope.run([tenantId, conversationId], callback);
}

function stateKey(waId) {
  // Unscoped legacy calls have their own namespace; scoped reads never fall back.
  return JSON.stringify([conversationScope.getStore() ?? null, waId]);
}

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
  const key = stateKey(waId);
  const v = flowState.get(key);
  if (!v) return null;
  if (_now() - v.updatedAt > FLOW_TTL_MS) {
    flowState.delete(key);
    return null;
  }
  return v;
}

function setFlowState(waId, partial) {
  const key = stateKey(waId);
  const prev = flowState.get(key) || {};
  const next = { ...prev, ...partial, updatedAt: _now() };
  flowState.set(key, next);
  if (flowState.size > 1000) _sweep(flowState);
  return next;
}

function clearFlowState(waId) {
  flowState.delete(stateKey(waId));
}

function markEscalated(waId) {
  escalated.set(stateKey(waId), _now() + ESCALATED_TTL_MS);
  if (escalated.size > 5000) _sweep(escalated);
}

function clearEscalated(waId) {
  escalated.delete(stateKey(waId));
}

function isEscalated(waId) {
  const key = stateKey(waId);
  const exp = escalated.get(key);
  if (!exp) return false;
  if (exp <= _now()) {
    escalated.delete(key);
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
  withConversation,
  getFlowState,
  setFlowState,
  clearFlowState,
  pushHistory,
  getHistory,
  markEscalated,
  clearEscalated,
  isEscalated,
  _reset: () => { flowState.clear(); escalated.clear(); },
  FLOW_TTL_MS,
  ESCALATED_TTL_MS,
  MAX_HISTORY,
};
