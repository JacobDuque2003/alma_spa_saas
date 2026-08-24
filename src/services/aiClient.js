// Claude Haiku 4.5 client for WhatsApp bot intent detection.
// Uses Anthropic Messages API directly (no SDK dependency).

const https = require('node:https');

const MODEL = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 8_000;
const MAX_RETRIES = 1;

const INTENT_ENUM = [
  'menu', 'list_services', 'service_info', 'book',
  'my_appointment', 'cancel', 'escalate', 'unclear',
];

const SYSTEM_PROMPT = `Eres el asistente virtual de Alma Spa, un spa en Zamora, Ecuador.
Tu ÚNICA tarea: leer el mensaje de la clienta y clasificarlo en una de estas intenciones:
${INTENT_ENUM.join(', ')}

Reglas:
- Responde SOLO con JSON válido: {"intent":"<intent>","reply":"<frase corta>"}
- "reply" máximo 40 palabras, español ecuatoriano, trato de "usted" por defecto.
- NUNCA inventes servicios, precios ni horarios.
- Si el mensaje no encaja en ninguna intención clara, usa "unclear".
- Si pide hablar con una persona, usa "escalate".
- Si pide ver el menú o saludos genéricos, usa "menu".
- Si pregunta por servicios o catálogo, usa "list_services".
- Si pregunta por un servicio específico, usa "service_info".
- Si quiere reservar, usa "book".
- Si pregunta por su cita, usa "my_appointment".
- Si quiere cancelar, usa "cancel".`;

// Haiku 4.5 pricing (per 1M tokens): input $1.00, output $5.00
const COST_PER_INPUT_TOKEN = 1.0 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 5.0 / 1_000_000;

function calcCost(inputTokens, outputTokens) {
  return inputTokens * COST_PER_INPUT_TOKEN + outputTokens * COST_PER_OUTPUT_TOKEN;
}

function _post(body) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Promise.reject(new Error('ANTHROPIC_API_KEY not set'));

  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const url = new URL(API_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          reject(new Error(`Anthropic non-JSON response: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Anthropic request timeout')); });
    req.end(payload);
  });
}

async function classifyIntent(userMessage, { tone = 'usted' } = {}) {
  const toneNote = tone === 'tu'
    ? 'La clienta usa "tú", responde también de "tú".'
    : '';

  const body = {
    model: MODEL,
    max_tokens: 120,
    system: SYSTEM_PROMPT + (toneNote ? `\n${toneNote}` : ''),
    messages: [{ role: 'user', content: userMessage }],
  };

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await _post(body);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Anthropic ${res.status}`);
        continue;
      }
      if (res.status !== 200) {
        return { ok: false, error: `Anthropic ${res.status}: ${JSON.stringify(res.data?.error?.message || res.data).slice(0, 200)}` };
      }

      const text = res.data?.content?.[0]?.text || '';
      const usage = res.data?.usage || {};
      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;

      let parsed;
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        parsed = null;
      }

      const intent = parsed?.intent && INTENT_ENUM.includes(parsed.intent)
        ? parsed.intent : 'unclear';
      const reply = parsed?.reply ? String(parsed.reply).slice(0, 200) : null;

      return {
        ok: true,
        intent,
        reply,
        model: MODEL,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd: calcCost(inputTokens, outputTokens),
      };
    } catch (err) {
      lastErr = err;
    }
  }
  return { ok: false, error: lastErr?.message || 'unknown' };
}

function isAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

module.exports = {
  classifyIntent,
  isAvailable,
  INTENT_ENUM,
  MODEL,
  COST_PER_INPUT_TOKEN,
  COST_PER_OUTPUT_TOKEN,
  calcCost,
};
