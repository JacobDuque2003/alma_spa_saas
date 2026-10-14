const test = require('node:test');
const assert = require('node:assert/strict');
const appointmentService = require('../appointmentService');
const { readOnlyReply } = require('./simulationReadOnly');
test('simulation returns actual slots in same turn without appointment writes', async (t) => {
  let queried = false;
  t.mock.method(appointmentService, 'getAvailability', async (args) => { queried = args.publicOnly && args.tenantId === 'one'; return ['2099-10-16T14:00:00Z']; });
  const result = await readOnlyReply({ tenantId: 'one', tenantConfig: { workDays: [1, 2, 3, 4, 5, 6, 7] },
    services: [{ id: 'service', name: 'Masaje', priceUsd: 30, durationMins: 105 }], knowledge: [], message: 'Masaje el 16 de octubre de 2099' });
  assert.equal(queried, true);
  assert.match(result.reply, /09:00/);
  assert.match(result.reply, /no se crean citas/);
  assert.doesNotMatch(result.reply, /Consultando/);
});
test('informative service never maps to a different bookable service', async () => {
  const result = await readOnlyReply({ tenantId: 'one', tenantConfig: {}, services: [{ id: 'massage', name: 'Masaje' }],
    knowledge: [{ title: 'Maderoterapia', category: 'Servicios', content: 'Cuidado corporal.' }], message: 'quiero maderoterapia' });
  assert.match(result.reply, /asesor|no lo sustituir/);
});
