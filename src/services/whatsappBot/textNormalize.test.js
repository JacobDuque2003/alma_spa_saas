const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeText, synonymIntent } = require('./textNormalize');
test('normalization understands real spelling errors without modifying original messages', () => {
  const samples = [
    ['kiero un masaje relajnte el biernes', 'quiero un masaje relajante el viernes'],
    ['cuanto sale la limpiesa facial', 'cuanto sale la limpieza facial'],
    ['q ora abren', 'que hora abren'], ['siii confirmooo', 'si confirmo'],
    ['graciaaas', 'gracias'], ['mñna xfa', 'manana por favor'],
  ];
  for (const [input, expected] of samples) assert.equal(normalizeText(input), expected);
  assert.equal(normalizeText('2026-10-16 a las 16:00', { preserveDatePunctuation: true }), '2026-10-16 a las 16:00');
});
test('configured synonyms distinguish actions from short contextual responses', () => {
  assert.equal(synonymIntent('quiero mover mi turno'), 'reschedule');
  assert.equal(synonymIntent('no puedo ir'), 'cancel');
  assert.equal(synonymIntent('mejor el lunes'), null);
  assert.equal(synonymIntent('el de piedras calientes'), null);
});
