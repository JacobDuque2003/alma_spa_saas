const prisma = require('../utils/prisma');

const DEFAULT_MESSAGE_LIMIT = 16;
const RECALL_MESSAGE_LIMIT = 40;
const MAX_MESSAGE_CHARS = 500;
const MAX_CONTEXT_CHARS = 6000;

const RECALL_RE = /\b(?:qu[eé]\s+(?:te\s+)?dije|qu[eé]\s+hab[ií]amos\s+(?:dicho|hablado|quedado)|recuerdas?\s+(?:lo\s+)?que|acu[eé]rdate\s+de|te\s+acuerdas\s+de)\b/i;

function isRecallRequest(text) {
  return RECALL_RE.test(String(text || ''));
}

function normalizeRows(rows, currentUserMessage) {
  const normalized = (Array.isArray(rows) ? rows : [])
    .slice()
    .reverse()
    .filter((row) => typeof row?.body === 'string' && row.body.trim())
    .map((row) => ({
      role: row.direction === 'inbound' ? 'user' : 'assistant',
      content: row.body.trim().slice(0, MAX_MESSAGE_CHARS),
    }));

  // El webhook guarda el mensaje entrante antes de invocar al bot. aiClient
  // agrega el mensaje actual por separado, así que eliminamos esa copia final.
  const current = String(currentUserMessage || '').trim();
  const last = normalized.at(-1);
  if (current && last?.role === 'user' && last.content === current.slice(0, MAX_MESSAGE_CHARS)) {
    normalized.pop();
  }

  let chars = 0;
  const bounded = [];
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const item = normalized[index];
    if (chars + item.content.length > MAX_CONTEXT_CHARS) break;
    bounded.push(item);
    chars += item.content.length;
  }
  return bounded.reverse();
}

async function loadConversationHistory({ tenantId, conversationId, currentUserMessage }) {
  if (!tenantId || !conversationId) return [];
  const take = isRecallRequest(currentUserMessage) ? RECALL_MESSAGE_LIMIT : DEFAULT_MESSAGE_LIMIT;

  try {
    const rows = await prisma.whatsAppMessage.findMany({
      where: { tenantId, conversationId, body: { not: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: { direction: true, body: true },
    });
    return normalizeRows(rows, currentUserMessage);
  } catch (error) {
    console.warn('[WA-MEMORY] no se pudo reconstruir el contexto', {
      tenantId,
      conversationId,
      error: error?.name || 'Error',
    });
    return [];
  }
}

module.exports = {
  loadConversationHistory,
  isRecallRequest,
  _internals: {
    normalizeRows,
    DEFAULT_MESSAGE_LIMIT,
    RECALL_MESSAGE_LIMIT,
    MAX_MESSAGE_CHARS,
    MAX_CONTEXT_CHARS,
  },
};
