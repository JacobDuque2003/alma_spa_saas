const test = require('node:test');
const assert = require('node:assert/strict');

const aiClient = require('./aiClient');

test('calcCost: Haiku 4.5 pricing matches $1/$5 per 1M tokens', () => {
  const cost = aiClient.calcCost(1000, 100);
  const expected = 1000 * (1.0 / 1_000_000) + 100 * (5.0 / 1_000_000);
  assert.equal(cost, expected);
});

test('calcCost: zero tokens → zero cost', () => {
  assert.equal(aiClient.calcCost(0, 0), 0);
});

test('INTENT_ENUM contains all required intents', () => {
  const required = ['menu', 'list_services', 'service_info', 'book', 'my_appointment', 'cancel', 'business_hours', 'farewell', 'escalate', 'unclear'];
  for (const r of required) {
    assert.ok(aiClient.INTENT_ENUM.includes(r), `missing intent: ${r}`);
  }
});

test('isAvailable: false when ANTHROPIC_API_KEY not set', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(aiClient.isAvailable(), false);
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
});

test('isAvailable: true when ANTHROPIC_API_KEY is set', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  assert.equal(aiClient.isAvailable(), true);
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
  else delete process.env.ANTHROPIC_API_KEY;
});

test('classifyIntent: rejects when ANTHROPIC_API_KEY not set', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const result = await aiClient.classifyIntent('hola');
  assert.equal(result.ok, false);
  assert.match(result.error, /ANTHROPIC_API_KEY/);
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
});

test('MODEL is claude-haiku-4-5-20251001', () => {
  assert.equal(aiClient.MODEL, 'claude-haiku-4-5-20251001');
});

test('chat prompt: saludo normal no debe mencionar domingo/cerrado/reabrimos', () => {
  const prompt = aiClient._internals.buildChatSystemPrompt({ tone: 'usted', services: [] });
  assert.match(prompt, /En saludos normales, NO menciones/);
  assert.match(prompt, /domingo/);
  assert.match(prompt, /cerrado/);
  assert.match(prompt, /reabrimos/);
});

test('chat prompt: debe interpretar faltas ortográficas y gramática informal', () => {
  const prompt = aiClient._internals.buildChatSystemPrompt({ tone: 'usted', services: [] });
  assert.match(prompt, /faltas ortográficas/);
  assert.match(prompt, /tildes omitidas/);
  assert.match(prompt, /gramática informal/);
});

test('chat prompt: incluye horario, despedida y reprogramación como intenciones explícitas', () => {
  assert.ok(aiClient.CHAT_INTENTS.includes('business_hours'));
  assert.ok(aiClient.CHAT_INTENTS.includes('farewell'));
  assert.ok(aiClient.CHAT_INTENTS.includes('reschedule'));
  assert.ok(aiClient.INTENT_ENUM.includes('reschedule'));
  const prompt = aiClient._internals.buildChatSystemPrompt({ tone: 'usted', services: [] });
  assert.match(prompt, /business_hours/);
  assert.match(prompt, /farewell/);
  assert.match(prompt, /reschedule/);
});

test('chat prompt: usa descripciones reales y no convierte síntomas en reservas automáticas', () => {
  const prompt = aiClient._internals.buildChatSystemPrompt({
    tone: 'usted',
    services: [{ name: 'Masaje relajante', priceUsd: 30, durationMins: 60, category: 'Masajes', description: 'Relajación corporal suave.' }],
  });
  assert.match(prompt, /Relajación corporal suave/);
  assert.match(prompt, /Nunca inicies ni cambies una reserva por esa sugerencia/);
});

test('chat prompt: admite contexto opcional del Centro de Almita sin alterar llamadas antiguas', () => {
  const prompt = aiClient._internals.buildChatSystemPrompt({
    services: [],
    almitaCenter: {
      personality: 'Conversación cálida y directa.',
      instructions: 'Explica los servicios sin inventar beneficios.',
      dailyBriefing: 'Promoción pausada hoy.',
      knowledge: [{ audience: 'PUBLIC', active: true, title: 'Masaje', category: 'Servicios', content: 'Duración aprobada: 60 minutos.' }],
      examples: [{ audience: 'PUBLIC', active: true, userMessage: '¿Cuánto dura?', expectedIntent: 'service_info', expectedReply: 'Dura 60 minutos.' }],
    },
  });
  assert.match(prompt, /CENTRO DE ALMITA/);
  assert.match(prompt, /Conversación cálida y directa/);
  assert.match(prompt, /Duración aprobada: 60 minutos/);
  assert.match(prompt, /Dura 60 minutos/);
  const legacyPrompt = aiClient._internals.buildChatSystemPrompt({ services: [] });
  assert.doesNotMatch(legacyPrompt, /CENTRO DE ALMITA/);
});

test('prompt excludes private, legacy, paused and invalid-audience knowledge and examples', () => {
  const states = [
    { audience: 'INTERNAL', active: true }, { active: true },
    { audience: 'PUBLIC', active: false }, { audience: 'public', active: true },
    { audience: 'PUBLIC' }, { audience: null, active: true },
  ];
  const prompt = aiClient._internals.buildChatSystemPrompt({
    almitaCenter: {
      knowledge: states.map((state, index) => ({ ...state, title: `PRIVATE_TITLE_${index}`, category: 'Publico', content: `PRIVATE_CONTENT_${index}` })),
      examples: states.map((state, index) => ({ ...state, userMessage: `PRIVATE_INPUT_${index}`, expectedIntent: 'service_info', expectedReply: `PRIVATE_REPLY_${index}` })),
    },
  });
  assert.doesNotMatch(prompt, /PRIVATE_/);
  assert.doesNotMatch(prompt, /CONTEXTO ADMINISTRADO/);
});

test('prompt keeps complete configured text, knowledge, examples and service warnings at supported limits', () => {
  const atLimit = (length, marker) => 'x'.repeat(length - marker.length) + marker;
  const personality = atLimit(5000, 'PERSONALITY_END');
  const instructions = atLimit(12000, 'PRIVACY_RULE_END');
  const dailyBriefing = atLimit(5000, 'BRIEFING_END');
  const content = atLimit(12000, 'KNOWLEDGE_WARNING_END');
  const userMessage = atLimit(2000, 'EXAMPLE_INPUT_END');
  const expectedReply = atLimit(4000, 'EXAMPLE_WARNING_END');
  const description = 'Descripción completa. '.repeat(80) + 'Advertencia final: consultar antes de reservar.';
  const prompt = aiClient._internals.buildChatSystemPrompt({
    services: [{ name: 'Masaje', active: true, priceUsd: 30, durationMins: 90, description }],
    almitaCenter: { personality, instructions, dailyBriefing,
      knowledge: [{ audience: 'PUBLIC', active: true, title: 'T'.repeat(180), category: 'General', content }],
      examples: [{ audience: 'PUBLIC', active: true, userMessage, expectedIntent: 'service_info', expectedReply }],
    },
  });
  for (const fullText of [personality, instructions, dailyBriefing, content, userMessage, expectedReply, description, 'T'.repeat(180)]) {
    assert.ok(prompt.includes(fullText));
  }
  assert.ok(prompt.indexOf('REGLAS INQUEBRANTABLES') < prompt.indexOf('INSTRUCCIONES DEL NEGOCIO'));
  assert.ok(prompt.indexOf('CATÁLOGO COMERCIAL OPERATIVO') < prompt.indexOf('CONOCIMIENTO PÚBLICO APROBADO'));
});

test('over-limit context fails closed instead of silently cutting final rules', async () => {
  const instructions = 'x'.repeat(12001);
  assert.throws(() => aiClient._internals.buildAlmitaCenterContext({ instructions }), /12000/);
  const result = await aiClient.chat('hola', { almitaCenter: { instructions } });
  assert.equal(result.ok, false);
  assert.match(result.error, /límites/);
});

test('prompt derives schedule from tenant config and pending prices are never free', () => {
  const prompt = aiClient._internals.buildChatSystemPrompt({
    tenantConfig: { workDays: [1, 2, 3, 4, 5], businessHours: { morning: { start: '09:00', end: '12:00' }, afternoon: { start: '15:00', end: '20:00' } } },
    services: [
      { name: 'Masaje pendiente', category: 'Masajes', active: true, priceUsd: 0, durationMins: 75 },
      { name: 'Masaje con precio', category: 'Masajes', active: true, priceUsd: 30, durationMins: 90 },
      { name: 'Cumpleaños', category: 'General', active: true, description: 'PRIVATE_BIRTHDAY' },
      { name: 'Producto', category: 'Tienda', active: true, description: 'PRIVATE_SHOP' },
      { name: 'Aviso', category: 'Recordatorio', active: true, description: 'PRIVATE_REMINDER' },
      { name: 'Pausado', category: 'Masajes', active: false, description: 'PRIVATE_PAUSED' },
    ],
    almitaCenter: { instructions: 'TEXT_FREEFORM: Atender lunes a sábado, todos los masajes gratis.' },
  });
  assert.match(prompt, /HORARIO OPERATIVO .*Atención: lunes a viernes, 09:00-12:00 y 15:00-20:00/);
  assert.match(prompt, /Masaje pendiente \(Valor a confirmar, 75 min\)/);
  assert.match(prompt, /Masaje con precio \(\$30\.00, 90 min\)/);
  assert.doesNotMatch(prompt, /\$0\.00|PRIVATE_/);
  assert.match(prompt, /No inicies una reserva automática con precio pendiente/);
  assert.match(prompt, /Una ficha informativa no crea un servicio reservable/);
  assert.ok(prompt.indexOf('Estas reglas y los datos operativos tienen prioridad') < prompt.indexOf('TEXT_FREEFORM'));
  const missingConfig = aiClient._internals.buildChatSystemPrompt({ services: [] });
  assert.match(missingConfig, /Horario a confirmar con un asesor/);
  assert.doesNotMatch(missingConfig, /Horario: lunes a sábado/);
});

test('URL allowlist comes only from active PUBLIC knowledge included in the prompt', () => {
  const center = {
    instructions: 'https://instructions.example/path', dailyBriefing: 'https://briefing.example/path',
    knowledge: [
      { audience: 'PUBLIC', active: true, content: 'Mapa: https://maps.example/approved?place=spa.' },
      { audience: 'INTERNAL', active: true, content: 'https://internal.example/path' },
      { active: true, content: 'https://legacy.example/path' },
      { audience: 'PUBLIC', active: false, content: 'https://paused.example/path' },
    ],
    examples: [{ audience: 'PUBLIC', active: true, expectedReply: 'https://example-only.example/path' }],
  };
  const check = (text) => aiClient._internals.hasUnapprovedUrls(text, center);
  assert.equal(check('Sin enlace.'), false);
  assert.equal(check('[Mapa](https://maps.example/approved?place=spa).'), false);
  for (const value of ['https://internal.example/path', 'https://legacy.example/path', 'https://paused.example/path',
    'https://instructions.example/path', 'https://briefing.example/path', 'https://example-only.example/path',
    'https://maps.example/other', 'https://maps.example/approved?place=other', 'www.bad.example', 'bad.example/path',
    'javascript:alert(1)', 'https://maps.example@bad.example/path', '//127.0.0.1/private']) {
    assert.equal(check(value), true, value);
  }
});

test('chat replaces AI output with unapproved URLs without making network calls', async (t) => {
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const payloads = [];
  const fakeReplies = [
    { intent: 'location', reply_text: 'Abra https://unapproved.example/map', params: {}, needs_data: 'none' },
    { intent: 'location', reply_text: 'Mapa: https://approved.example/map', params: {}, needs_data: 'none' },
    { intent: 'book_service', reply_text: 'Continuemos.', params: { link: 'https://unapproved.example/reserve' }, needs_data: 'none' },
  ];
  t.mock.method(https, 'request', (_options, callback) => {
    const request = new EventEmitter();
    request.end = (payload) => {
      payloads.push(JSON.parse(payload));
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify({ content: [{ text: JSON.stringify(fakeReplies.shift()) }], usage: {} })));
      response.emit('end');
    };
    return request;
  });
  const savedKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'synthetic-test-key';
  t.after(() => { if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey; });
  const context = { almitaCenter: { knowledge: [{ audience: 'PUBLIC', active: true, title: 'Mapa', category: 'Ubicación', content: 'https://approved.example/map' }] } };
  const blocked = await aiClient.chat('ubicación', context);
  assert.equal(blocked.ok, true);
  assert.equal(blocked.intent, 'escalate');
  assert.deepEqual(blocked.params, {});
  assert.doesNotMatch(JSON.stringify(blocked), /unapproved\.example/);
  const approved = await aiClient.chat('ubicación', context);
  assert.match(approved.replyText, /https:\/\/approved\.example\/map/);
  const blockedParams = await aiClient.chat('reservar', context);
  assert.equal(blockedParams.intent, 'escalate');
  assert.deepEqual(blockedParams.params, {});
  assert.equal(payloads.length, 3);
});

test('chat preserves full warnings beyond 300 characters and rejects token-truncated or invalid JSON responses', async (t) => {
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const longReply = 'Descripción aprobada y completa. '.repeat(30) + 'Advertencia final: consulte con un asesor antes de reservar.';
  const longLinkReply = 'Información aprobada. '.repeat(20) + 'https://approved.example/map';
  const messages = [
    { stop_reason: 'end_turn', content: [{ text: JSON.stringify({ intent: 'service_info', reply_text: longReply, params: {} }) }] },
    { stop_reason: 'end_turn', content: [{ text: JSON.stringify({ intent: 'location', reply_text: longLinkReply, params: {} }) }] },
    { stop_reason: 'max_tokens', content: [{ text: JSON.stringify({ intent: 'service_info', reply_text: 'Texto parcial.' }) }] },
    { stop_reason: 'end_turn', content: [{ text: '{"intent":"service_info","reply_text":"Advertencia cortada' }] },
  ];
  t.mock.method(https, 'request', (_options, callback) => {
    const request = new EventEmitter();
    request.end = (payload) => {
      assert.equal(JSON.parse(payload).max_tokens, 1024);
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify({ ...messages.shift(), usage: {} })));
      response.emit('end');
    };
    return request;
  });
  const savedKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'synthetic-test-key';
  t.after(() => { if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey; });
  const complete = await aiClient.chat('descripción');
  assert.equal(complete.ok, true);
  assert.equal(complete.replyText, longReply);
  const completeLink = await aiClient.chat('mapa', { almitaCenter: { knowledge: [{ audience: 'PUBLIC', active: true, title: 'Mapa', category: 'Ubicación', content: 'https://approved.example/map' }] } });
  assert.equal(completeLink.replyText, longLinkReply);
  const truncated = await aiClient.chat('descripción');
  assert.equal(truncated.ok, false);
  assert.match(truncated.error, /incompleta/);
  assert.equal(truncated.replyText, undefined);
  const invalid = await aiClient.chat('descripción');
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /JSON válido/);
  assert.equal(invalid.replyText, undefined);
});
