// Rate limit por número de WhatsApp para el bot. In-memory (Fase 1, un solo
// proceso). Dos ventanas apiladas: 20 mensajes en 5 min y 100 en 1 hora.
// Al exceder cualquiera, el bot envía UNA vez un aviso corto y entra en
// silencio 15 min para ese número. Si vuelve a exceder tras el cool-down,
// vuelve a avisar. Sin costo variable — solo un contador por wa_id.

const WINDOWS = [
  { key: 'short', ms: 5 * 60 * 1000, max: 20 },
  { key: 'hour', ms: 60 * 60 * 1000, max: 100 },
];
const COOLDOWN_MS = 15 * 60 * 1000;

const buckets = new Map();   // waId -> { events: number[] (timestamps), cooldownUntil?, warnedInCooldown? }

function _now() { return Date.now(); }

function _prune(bucket) {
  const cutoff = _now() - WINDOWS[WINDOWS.length - 1].ms;
  bucket.events = bucket.events.filter((t) => t > cutoff);
}

// Devuelve:
//  - { allowed: true }                        → el bot puede responder
//  - { allowed: false, warn: true }           → responder UNA vez con aviso corto (primer exceso)
//  - { allowed: false, warn: false }          → silencio (dentro de cool-down)
function check(waId) {
  const now = _now();
  let bucket = buckets.get(waId);
  if (!bucket) {
    bucket = { events: [] };
    buckets.set(waId, bucket);
  }

  // Si estamos en cool-down y no expiró todavía, silencio.
  if (bucket.cooldownUntil && bucket.cooldownUntil > now) {
    return { allowed: false, warn: false };
  }
  // Cool-down expiró — reset.
  if (bucket.cooldownUntil && bucket.cooldownUntil <= now) {
    bucket.cooldownUntil = undefined;
    bucket.warnedInCooldown = false;
    bucket.events = [];
  }

  bucket.events.push(now);
  _prune(bucket);

  for (const w of WINDOWS) {
    const inWindow = bucket.events.filter((t) => t > now - w.ms).length;
    if (inWindow > w.max) {
      bucket.cooldownUntil = now + COOLDOWN_MS;
      if (!bucket.warnedInCooldown) {
        bucket.warnedInCooldown = true;
        return { allowed: false, warn: true };
      }
      return { allowed: false, warn: false };
    }
  }
  return { allowed: true };
}

module.exports = {
  check,
  _reset: () => buckets.clear(),
  COOLDOWN_MS,
  WINDOWS,
};
