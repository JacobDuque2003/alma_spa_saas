const TELEGRAM_API = 'https://api.telegram.org';
const DEFAULT_COOLDOWN_MS = 15 * 60_000;
const SEND_TIMEOUT_MS = 8_000;
const SYSTEM_NAME = 'Alma_Spa';
const recentAlerts = new Map();

function isEnabled() {
  return process.env.TELEGRAM_ALERTS_ENABLED !== 'false'
    && Boolean(process.env.TELEGRAM_BOT_TOKEN)
    && Boolean(process.env.TELEGRAM_ALERT_CHAT_ID);
}

function clean(value, max = 700) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s:@]+:[^\s@]+@/gi, '[URL protegida]')
    .replace(/\b(EAA|sk-ant-)[A-Za-z0-9_-]+/g, '[credencial protegida]')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function shouldSend(key, cooldownMs) {
  if (!key) return true;
  const now = Date.now();
  const previous = recentAlerts.get(key) || 0;
  if (now - previous < cooldownMs) return false;
  recentAlerts.set(key, now);
  if (recentAlerts.size > 300) {
    for (const [storedKey, sentAt] of recentAlerts) {
      if (now - sentAt > 24 * 60 * 60_000) recentAlerts.delete(storedKey);
    }
  }
  return true;
}

async function sendAlert({ severity = 'info', title, details = [], dedupeKey, cooldownMs = DEFAULT_COOLDOWN_MS }) {
  if (!isEnabled()) return { ok: false, skipped: 'not_configured' };
  if (!shouldSend(dedupeKey, cooldownMs)) return { ok: false, skipped: 'deduplicated' };

  const icons = { info: '🟢', warning: '🟡', critical: '🔴', recovery: '🔵' };
  const ecuadorTime = new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());
  const lines = [
    `${icons[severity] || icons.info} [${SYSTEM_NAME}] ${clean(title, 180)}`,
    `🕒 ${ecuadorTime} (Ecuador)`,
    '',
    ...details.filter((item) => item?.value !== undefined && item?.value !== null && item?.value !== '')
      .map((item) => `• ${clean(item.label, 80)}: ${clean(item.value)}`),
    `• Ambiente: ${clean(process.env.NODE_ENV || 'development', 40)}`,
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_ALERT_CHAT_ID,
        text: lines.join('\n').slice(0, 4000),
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`[TELEGRAM] No se pudo entregar alerta (HTTP ${response.status})`);
      return { ok: false, status: response.status };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[TELEGRAM] No se pudo entregar alerta: ${clean(err?.message || err, 200)}`);
    return { ok: false, error: clean(err?.message || err, 200) };
  } finally {
    clearTimeout(timer);
  }
}

function alertAsync(payload) {
  sendAlert(payload).catch(() => {});
}

function resetForTests() {
  recentAlerts.clear();
}

module.exports = { isEnabled, sendAlert, alertAsync, resetForTests };
