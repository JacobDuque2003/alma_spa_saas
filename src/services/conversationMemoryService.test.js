const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../utils/prisma');
const memory = require('./conversationMemoryService');

test('detecta solicitudes explícitas de recordar', () => {
  assert.equal(memory.isRecallRequest('¿Qué te dije ayer?'), true);
  assert.equal(memory.isRecallRequest('¿Qué habíamos quedado?'), true);
  assert.equal(memory.isRecallRequest('Quiero reservar un masaje'), false);
});

test('consulta memoria aislada por tenant y conversación', async () => {
  let query;
  prisma.whatsAppMessage = {
    findMany: async (args) => {
      query = args;
      return [
        { direction: 'inbound', body: '¿Qué te dije?' },
        { direction: 'outbound', body: 'Le ayudo con gusto.' },
        { direction: 'inbound', body: 'Prefiero venir el viernes.' },
      ];
    },
  };

  const history = await memory.loadConversationHistory({
    tenantId: 'tenant-alma',
    conversationId: 'conv-1',
    currentUserMessage: '¿Qué te dije?',
  });

  assert.equal(query.where.tenantId, 'tenant-alma');
  assert.equal(query.where.conversationId, 'conv-1');
  assert.equal(query.take, memory._internals.RECALL_MESSAGE_LIMIT);
  assert.deepEqual(history, [
    { role: 'user', content: 'Prefiero venir el viernes.' },
    { role: 'assistant', content: 'Le ayudo con gusto.' },
  ]);
});

test('limita tamaño por mensaje y contexto total', () => {
  const huge = 'x'.repeat(2000);
  const rows = Array.from({ length: 30 }, (_, index) => ({
    direction: index % 2 ? 'outbound' : 'inbound',
    body: huge,
  }));
  const history = memory._internals.normalizeRows(rows, 'mensaje distinto');
  assert.ok(history.length <= 12);
  assert.ok(history.every((item) => item.content.length <= memory._internals.MAX_MESSAGE_CHARS));
  assert.ok(history.reduce((sum, item) => sum + item.content.length, 0) <= memory._internals.MAX_CONTEXT_CHARS);
});

test('falla de base degrada a memoria vacía sin filtrar contenido', async () => {
  prisma.whatsAppMessage = { findMany: async () => { throw new Error('detalle sensible'); } };
  const history = await memory.loadConversationHistory({
    tenantId: 'tenant-alma',
    conversationId: 'conv-1',
    currentUserMessage: 'hola',
  });
  assert.deepEqual(history, []);
});
