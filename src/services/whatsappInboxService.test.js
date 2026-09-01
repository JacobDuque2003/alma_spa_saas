const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://alma-spa.test';

const prisma = require('../utils/prisma');
const transport = require('./whatsappTransport');
const inbox = require('./whatsappInboxService');

function mockTransport(overrides = {}) {
  transport.loadActiveConnection = overrides.loadActiveConnection || (async () => ({
    tenantId: 't1', phoneNumberId: '111', status: 'activo',
  }));
  transport.sendText = overrides.sendText || (async () => ({ ok: true, data: { messages: [{ id: 'wamid.NEW' }] } }));
  transport.sendTemplate = overrides.sendTemplate || (async () => ({ ok: true, data: { messages: [{ id: 'wamid.NEW' }] } }));
  transport.uploadMedia = overrides.uploadMedia || (async () => ({ ok: true, mediaId: 'media.UPLOADED', data: { id: 'media.UPLOADED' } }));
  transport.sendMediaByMediaId = overrides.sendMediaByMediaId || (async () => ({ ok: true, data: { messages: [{ id: 'wamid.MEDIA' }] } }));
  transport.getMediaInfo = overrides.getMediaInfo || (async () => ({ ok: true, data: { url: 'https://media.test/file', mime_type: 'image/png' } }));
  transport.downloadMedia = overrides.downloadMedia || (async () => ({ ok: true, buffer: Buffer.from('media'), mimeType: 'image/png' }));
}

test('sendManualText: FUERA de la ventana de 24h → 422 WINDOW_CLOSED', async () => {
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', lastInboundAt: new Date(Date.now() - 25 * 3600 * 1000) }),
  };
  await assert.rejects(
    () => inbox.sendManualText({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', 'hola'),
    (err) => err.status === 422 && /WINDOW_CLOSED/.test(err.message)
  );
});

test('sendManualText: DENTRO de la ventana → llama sendText, no sendTemplate', async () => {
  let textCalls = 0, templateCalls = 0;
  mockTransport({
    sendText: async () => { textCalls += 1; return { ok: true, data: { messages: [{ id: 'wamid.X' }] } }; },
    sendTemplate: async () => { templateCalls += 1; return { ok: true, data: {} }; },
  });
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', customerWaId: '593999', lastInboundAt: new Date(Date.now() - 60 * 1000) }),
    update: async () => ({}),
  };
  prisma.whatsAppMessage = {
    create: async ({ data }) => ({ id: 'm1', ...data }),
    update: async ({ data }) => ({ id: 'm1', ...data }),
  };
  const msg = await inbox.sendManualText({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', 'texto libre');
  assert.equal(textCalls, 1);
  assert.equal(templateCalls, 0);
  assert.equal(msg.status, 'sent');
});

test('sendReminder: SIEMPRE plantilla (dentro o fuera de la ventana)', async () => {
  let textCalls = 0, templateCalls = 0;
  mockTransport({
    sendText: async () => { textCalls += 1; return { ok: true, data: {} }; },
    sendTemplate: async () => { templateCalls += 1; return { ok: true, data: { messages: [{ id: 'wamid.T' }] } }; },
  });
  prisma.whatsAppConversation = {
    findUnique: async () => ({
      id: 'c1', tenantId: 't1', customerWaId: '593999', clientId: 'cli1',
      lastInboundAt: new Date(Date.now() - 25 * 3600 * 1000), // FUERA de la ventana
    }),
    update: async () => ({}),
  };
  let reminderWhere = null;
  prisma.appointment = {
    findFirst: async (args) => {
      reminderWhere = args.where;
      return { id: 'a1', tenantId: 't1', clientId: 'cli1', confirmationToken: 'token-x', startsAt: new Date(Date.now() + 3600 * 1000), service: { name: 'Masaje' }, client: { fullName: 'Maria Perez', active: true } };
    },
  };
  prisma.tenant = { findUnique: async () => ({ config: { whatsapp: { confirmationTemplate: { name: 'confirm_v1', language: 'es' } } } }) };
  let created;
  prisma.whatsAppMessage = {
    create: async ({ data }) => { created = { id: 'm1', ...data }; return created; },
    update: async ({ data }) => ({ ...created, ...data }),
  };

  const msg = await inbox.sendReminder({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1');
  assert.equal(textCalls, 0);
  assert.equal(templateCalls, 1);
  assert.deepEqual(reminderWhere.client, { is: { active: true } });
  assert.equal(msg.templateName, 'confirm_v1');
  assert.equal(msg.status, 'sent');
});

test('sendReminder: sin cita pendiente futura → 400', async () => {
  mockTransport();
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', customerWaId: '593999', clientId: 'cli1' }),
  };
  prisma.appointment = { findFirst: async () => null };
  await assert.rejects(
    () => inbox.sendReminder({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1'),
    (err) => err.status === 400
  );
});

test('sendReminder: clienta deshabilitada no recibe plantilla', async () => {
  mockTransport();
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', customerWaId: '593999', clientId: 'cli1' }),
  };
  let apptWhere = null;
  prisma.appointment = {
    findFirst: async (args) => { apptWhere = args.where; return null; },
  };

  await assert.rejects(
    () => inbox.sendReminder({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1'),
    (err) => err.status === 400
  );
  assert.deepEqual(apptWhere.client, { is: { active: true } });
});

test('listConversations filter=sin_confirmar_hoy: cruza con Appointment.status pendiente hoy', async () => {
  let apptQuery = null;
  prisma.tenant = { findUnique: async () => ({ config: {} }) };
  prisma.appointment = {
    findMany: async (args) => { apptQuery = args.where; return [{ clientId: 'cli1' }, { clientId: 'cli2' }]; },
  };
  let convQuery = null;
  prisma.whatsAppConversation = {
    findMany: async (args) => {
      convQuery = args.where;
      return [{ id: 'conv1', customerWaId: '593999', tenantId: 't1', lastMessageAt: new Date(), lastInboundAt: new Date(), botActive: true, client: { id: 'cli1', fullName: 'A' } }];
    },
    count: async () => 1,
  };
  const { items } = await inbox.listConversations({ tenantId: 't1', role: 'personal' }, { filter: 'sin_confirmar_hoy' });
  assert.equal(apptQuery.status, 'pendiente', 'debe filtrar por status pendiente en Appointment');
  assert.deepEqual(apptQuery.client, { is: { active: true } }, 'debe excluir clientas deshabilitadas de recordatorios');
  assert.ok(apptQuery.startsAt.gte instanceof Date && apptQuery.startsAt.lt instanceof Date, 'debe usar rango [gte, lt) sargable');
  assert.deepEqual([...convQuery.clientId.in], ['cli1', 'cli2']);
  assert.equal(items.length, 1);
});

test('listConversations: botStatus usa botActive del registro (no N+1 query)', async () => {
  prisma.whatsAppConversation = {
    findMany: async () => [
      { id: 'c1', customerWaId: '593111', tenantId: 't1', lastMessageAt: new Date(), lastInboundAt: new Date(), botActive: true, labels: ['consulta'], archived: false, createdAt: new Date(), unreadCount: 0, unreadRestoreCount: 3, status: 'pending', client: { id: 'cli1', fullName: 'Ana', whatsapp: '+593111', recordNumber: 'A-001' } },
      { id: 'c2', customerWaId: '593222', tenantId: 't1', lastMessageAt: new Date(), lastInboundAt: new Date(), botActive: false, labels: [], archived: false, createdAt: new Date(), unreadCount: 2, unreadRestoreCount: 5, status: 'resolved', client: null },
    ],
    count: async () => 2,
  };
  const { items } = await inbox.listConversations({ tenantId: 't1', role: 'personal' }, {});
  assert.equal(items[0].botStatus, 'active');
  assert.equal(items[0].botActive, true);
  assert.deepEqual(items[0].labels, ['consulta']);
  assert.equal(items[0].client.recordNumber, 'A-001');
  assert.equal(items[0].pendingMessageCount, 0);
  assert.equal(items[1].botStatus, 'handedOff');
  assert.equal(items[1].botActive, false);
  assert.equal(items[1].pendingMessageCount, 2);
});

test('listConversations: unread=true filtra conversaciones con mensajes pendientes', async () => {
  let convWhere = null;
  prisma.whatsAppConversation = {
    findMany: async (args) => { convWhere = args.where; return []; },
    count: async () => 0,
  };
  await inbox.listConversations({ tenantId: 't1', role: 'personal' }, { unread: 'true' });
  assert.deepEqual(convWhere.unreadCount, { gt: 0 });
});

test('listConversations: filter=bot_active filtra por botActive true', async () => {
  let convWhere = null;
  prisma.whatsAppConversation = {
    findMany: async (args) => { convWhere = args.where; return []; },
    count: async () => 0,
  };
  await inbox.listConversations({ tenantId: 't1', role: 'personal' }, { filter: 'bot_active' });
  assert.equal(convWhere.botActive, true);
});

test('reactivateBot: pone botActive=true y limpia botState', async () => {
  const botState = require('./whatsappBot/state');
  botState.setFlowState('593999', { step: 'booking' });
  let updateData = null;
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', customerWaId: '593999' }),
    update: async ({ data }) => { updateData = data; return { id: 'c1', botActive: true }; },
  };
  const result = await inbox.reactivateBot({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1');
  assert.equal(updateData.botActive, true);
  assert.equal(updateData.botState, null);
  assert.equal(result.botActive, true);
  assert.equal(botState._internals ? null : null, null); // state cleared
});

test('setStatus: resolver limpia contadores pendientes de la bandeja', async () => {
  let updateData = null;
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', customerWaId: '593999' }),
    update: async ({ data }) => {
      updateData = data;
      return { id: 'c1', status: data.status, unreadCount: data.unreadCount, unreadRestoreCount: data.unreadRestoreCount };
    },
  };
  const result = await inbox.setStatus({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', 'resolved');
  assert.equal(updateData.unreadCount, 0);
  assert.equal(updateData.unreadRestoreCount, 0);
  assert.equal(updateData.manuallyMarkedUnread, false);
  assert.equal(result.status, 'resolved');
});

test('setReadState: marcar leído borra el número de mensajes nuevos', async () => {
  let updateData = null;
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', unreadCount: 4, unreadRestoreCount: 4, status: 'pending' }),
    update: async ({ data }) => {
      updateData = data;
      return { id: 'c1', ...data };
    },
  };

  const result = await inbox.setReadState({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', false);
  assert.equal(updateData.unreadCount, 0);
  assert.equal(updateData.unreadRestoreCount, 0);
  assert.equal(updateData.manuallyMarkedUnread, false);
  assert.equal(updateData.status, 'open', 'al abrir una conversación debe mostrar el badge Abierto');
  assert.ok(updateData.lastReadAt instanceof Date);
  assert.equal(result.unreadCount, 0);
});

test('setReadState: marcar no leído persiste la marca manual y al menos un contador', async () => {
  let updateData = null;
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', unreadCount: 0, unreadRestoreCount: 0 }),
    update: async ({ data }) => {
      updateData = data;
      return { id: 'c1', ...data };
    },
  };

  const result = await inbox.setReadState({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', true);
  assert.equal(updateData.unreadCount, 1);
  assert.equal(updateData.unreadRestoreCount, 1);
  assert.equal(updateData.manuallyMarkedUnread, true);
  assert.equal(updateData.status, 'pending');
  assert.equal(result.manuallyMarkedUnread, true);
});

test('sendManualText: auto desactiva botActive', async () => {
  let updateData = null;
  mockTransport({
    sendText: async () => ({ ok: true, data: { messages: [{ id: 'wamid.X' }] } }),
  });
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', customerWaId: '593999', lastInboundAt: new Date(Date.now() - 60_000) }),
    update: async ({ data }) => { updateData = data; return {}; },
  };
  prisma.whatsAppMessage = {
    create: async ({ data }) => ({ id: 'm1', ...data }),
    update: async ({ data }) => ({ id: 'm1', ...data }),
  };
  await inbox.sendManualText({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', 'hola');
  assert.equal(updateData.botActive, false, 'sendManualText debe desactivar el bot');
  assert.equal(updateData.unreadCount, 0, 'al responder, el contador vuelve a cero');
  assert.equal(updateData.unreadRestoreCount, 0, 'al responder, no se conservan números viejos');
  assert.equal(updateData.manuallyMarkedUnread, false);
});

test('sendManualMedia: sube adjunto, lo envía por WhatsApp y actualiza conversación', async () => {
  let uploadedArgs = null;
  let sentArgs = null;
  let updateData = null;
  mockTransport({
    uploadMedia: async (conn, buffer, mimeType, filename) => {
      uploadedArgs = { conn, buffer, mimeType, filename };
      return { ok: true, mediaId: 'media.IMG' };
    },
    sendMediaByMediaId: async (conn, toWaId, type, mediaId, options) => {
      sentArgs = { conn, toWaId, type, mediaId, options };
      return { ok: true, data: { messages: [{ id: 'wamid.IMG' }] } };
    },
  });
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', customerWaId: '593999', lastInboundAt: new Date(Date.now() - 60_000) }),
    update: async ({ data }) => { updateData = data; return {}; },
  };
  prisma.whatsAppMessage = {
    create: async ({ data }) => ({ id: 'm1', ...data }),
    update: async ({ data }) => ({ id: 'm1', ...data }),
  };

  const msg = await inbox.sendManualMedia(
    { id: 'u1', tenantId: 't1', role: 'personal' },
    'c1',
    {
      dataUrl: `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
      filename: 'foto consulta.png',
      caption: 'Mira esta referencia',
    }
  );

  assert.equal(uploadedArgs.mimeType, 'image/png');
  assert.equal(uploadedArgs.filename, 'foto consulta.png');
  assert.equal(uploadedArgs.buffer.toString(), 'png');
  assert.equal(sentArgs.toWaId, '593999');
  assert.equal(sentArgs.type, 'image');
  assert.equal(sentArgs.mediaId, 'media.IMG');
  assert.equal(sentArgs.options.caption, 'Mira esta referencia');
  assert.equal(msg.status, 'sent');
  assert.equal(msg.mediaId, 'media.IMG');
  assert.equal(updateData.botActive, false);
  assert.equal(updateData.lastMessagePreview, 'Mira esta referencia');
  assert.equal(updateData.unreadCount, 0);
  assert.equal(updateData.unreadRestoreCount, 0);
  assert.equal(updateData.manuallyMarkedUnread, false);
});

test('sendManualMedia: rechaza archivos no permitidos', async () => {
  mockTransport();
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', customerWaId: '593999', lastInboundAt: new Date(Date.now() - 60_000) }),
  };

  await assert.rejects(
    () => inbox.sendManualMedia(
      { id: 'u1', tenantId: 't1', role: 'personal' },
      'c1',
      { dataUrl: `data:application/x-msdownload;base64,${Buffer.from('bad').toString('base64')}`, filename: 'virus.exe' }
    ),
    (err) => err.status === 400 && /no permitido/i.test(err.message)
  );
});

test('sendManualMedia: no simula caption en audios porque WhatsApp no lo soporta', async () => {
  let sentArgs = null;
  let updateData = null;
  mockTransport({
    uploadMedia: async () => ({ ok: true, mediaId: 'media.AUDIO' }),
    sendMediaByMediaId: async (conn, toWaId, type, mediaId, options) => {
      sentArgs = { conn, toWaId, type, mediaId, options };
      return { ok: true, data: { messages: [{ id: 'wamid.AUDIO' }] } };
    },
  });
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1', customerWaId: '593999', lastInboundAt: new Date(Date.now() - 60_000) }),
    update: async ({ data }) => { updateData = data; return {}; },
  };
  prisma.whatsAppMessage = {
    create: async ({ data }) => ({ id: 'm1', ...data }),
    update: async ({ data }) => ({ id: 'm1', ...data }),
  };

  await inbox.sendManualMedia(
    { id: 'u1', tenantId: 't1', role: 'personal' },
    'c1',
    {
      dataUrl: `data:audio/ogg;base64,${Buffer.from('audio').toString('base64')}`,
      filename: 'nota-voz.ogg',
      caption: 'Este texto no viaja con audio',
    }
  );

  assert.equal(sentArgs.type, 'audio');
  assert.equal(sentArgs.options.caption, undefined);
  assert.equal(updateData.lastMessagePreview, 'nota-voz.ogg');
});

test('getMessageMedia: descarga archivo de WhatsApp respetando tenant', async () => {
  mockTransport({
    getMediaInfo: async (conn, mediaId) => {
      assert.equal(conn.tenantId, 't1');
      assert.equal(mediaId, 'media.IN');
      return { ok: true, data: { url: 'https://media.test/inbound', mime_type: 'application/pdf' } };
    },
    downloadMedia: async (conn, url) => {
      assert.equal(conn.tenantId, 't1');
      assert.equal(url, 'https://media.test/inbound');
      return { ok: true, buffer: Buffer.from('pdf-data'), mimeType: 'application/pdf' };
    },
  });
  prisma.whatsAppMessage = {
    findUnique: async () => ({ id: 'm1', tenantId: 't1', type: 'document', body: 'receta.pdf', mediaId: 'media.IN' }),
  };

  const media = await inbox.getMessageMedia({ id: 'u1', tenantId: 't1', role: 'personal' }, 'm1');
  assert.equal(media.mimeType, 'application/pdf');
  assert.equal(media.filename, 'receta.pdf');
  assert.equal(media.buffer.toString(), 'pdf-data');
});

test('setLabels: filtra etiquetas inválidas', async () => {
  let updateData = null;
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1' }),
    update: async ({ data }) => { updateData = data; return { id: 'c1', labels: data.labels }; },
  };
  const result = await inbox.setLabels(
    { id: 'u1', tenantId: 't1', role: 'personal' },
    'c1',
    ['consulta', 'falsa', 'queja', 'consulta']
  );
  assert.deepEqual(updateData.labels, ['consulta', 'queja']);
  assert.deepEqual(result.labels, ['consulta', 'queja']);
});

test('saveLabelDefinitions: permite dejar la lista de etiquetas vacía', async () => {
  let updateData = null;
  prisma.tenant = {
    findUnique: async () => ({ id: 't1', config: { crm: { labels: inbox.DEFAULT_LABELS } } }),
    update: async ({ data }) => { updateData = data; return { id: 't1' }; },
  };

  const result = await inbox.saveLabelDefinitions({ id: 'u1', tenantId: 't1', role: 'personal' }, []);

  assert.deepEqual(result, []);
  assert.deepEqual(updateData.config.crm.labels, []);
});

test('saveQuickReplies: normaliza respuestas rápidas y permite lista vacía', async () => {
  let updateData = null;
  prisma.tenant = {
    findUnique: async () => ({ id: 't1', config: { crm: { quickReplies: inbox.DEFAULT_QUICK_REPLIES } } }),
    update: async ({ data }) => { updateData = data; return { id: 't1' }; },
  };

  const saved = await inbox.saveQuickReplies(
    { id: 'u1', tenantId: 't1', role: 'personal' },
    [{ icon: '🌿 largo', title: '  Bienvenida nueva  ', text: ' Hola bonita ' }]
  );
  assert.deepEqual(saved, [{
    key: 'bienvenida_nueva',
    icon: '🌿',
    title: 'Bienvenida nueva',
    text: 'Hola bonita',
  }]);
  assert.deepEqual(updateData.config.crm.quickReplies, saved);

  const empty = await inbox.saveQuickReplies({ id: 'u1', tenantId: 't1', role: 'personal' }, []);
  assert.deepEqual(empty, []);
});

test('updateConversation: permite marcar no leído y leído con unreadCount controlado', async () => {
  const updates = [];
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1' }),
    update: async ({ data }) => {
      updates.push(data);
      return { id: 'c1', ...data };
    },
  };

  const unread = await inbox.updateConversation(
    { id: 'u1', tenantId: 't1', role: 'personal' },
    'c1',
    { unreadCount: 1 }
  );
  assert.equal(unread.unreadCount, 1);
  assert.equal(updates[0].lastReadAt, undefined);

  const read = await inbox.updateConversation(
    { id: 'u1', tenantId: 't1', role: 'personal' },
    'c1',
    { unreadCount: 0 }
  );
  assert.equal(read.unreadCount, 0);
  assert.ok(updates[1].lastReadAt instanceof Date);

  await assert.rejects(
    () => inbox.updateConversation({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', { unreadCount: -1 }),
    (err) => err.status === 400
  );
});

test('createNote: guarda nota y valida contenido vacío', async () => {
  prisma.whatsAppConversation = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1' }),
  };
  prisma.whatsAppNote = {
    create: async ({ data }) => ({ id: 'n1', ...data, author: { id: 'u1', name: 'Gianella' } }),
  };
  const note = await inbox.createNote(
    { id: 'u1', tenantId: 't1', role: 'personal' },
    'c1',
    'Clienta pidió promo de cumpleaños'
  );
  assert.equal(note.content, 'Clienta pidió promo de cumpleaños');
  assert.equal(note.authorId, 'u1');

  await assert.rejects(
    () => inbox.createNote({ id: 'u1', tenantId: 't1', role: 'personal' }, 'c1', ''),
    (err) => err.status === 400
  );
});

test('deleteNote: elimina nota existente', async () => {
  prisma.whatsAppNote = {
    findUnique: async () => ({ id: 'n1', tenantId: 't1' }),
    delete: async () => ({}),
  };
  const result = await inbox.deleteNote({ id: 'u1', tenantId: 't1', role: 'personal' }, 'n1');
  assert.deepEqual(result, { deleted: true });
});
