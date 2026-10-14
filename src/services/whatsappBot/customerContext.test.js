const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../../utils/prisma');
const { firstName, safeHistory, loadCustomerContext } = require('./customerContext');
test('customer context uses first name and removes clinical and identifying history', () => {
  assert.equal(firstName('Ana Apellido'), 'Ana');
  assert.deepEqual(safeHistory([{ role: 'user', content: 'Mi cédula es 0123456789' },
    { role: 'user', content: 'Estoy embarazada' }, { role: 'user', content: 'Mejor el lunes' }]), [{ role: 'user', content: 'Mejor el lunes' }]);
});
test('last service query selects no clinical notes and is scoped to verified client', async (t) => {
  let query;
  const original = prisma.treatmentHistory;
  prisma.treatmentHistory = { findFirst: async (args) => { query = args; return { service: { name: 'Masaje' } }; } };
  t.after(() => { prisma.treatmentHistory = original; });
  assert.deepEqual(await loadCustomerContext('one', { id: 'client', tenantId: 'other' }), {});
  assert.deepEqual(await loadCustomerContext('one', { id: 'client', tenantId: 'one', fullName: 'Ana Apellido' }), { firstName: 'Ana', lastServiceName: 'Masaje' });
  assert.deepEqual(query.select, { service: { select: { name: true } } });
  assert.equal(query.where.tenantId, 'one');
});
