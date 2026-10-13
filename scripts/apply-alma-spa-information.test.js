const test = require('node:test');
const assert = require('node:assert/strict');
const approved = require('../docs/descripciones-servicios-aprobadas.json');
const { planInformation, applyInformation } = require('./apply-alma-spa-information');

test('solo considera los once textos informativos pendientes', () => {
  const plan = planInformation([]);
  assert.equal(plan.create.length, 11);
  assert.ok(!plan.create.some((row) => row.title === 'Camilla Ceragem'));
  for (const row of plan.create) {
    assert.equal(row.content, approved.find((entry) => entry.name === row.title).description);
    assert.ok(!Object.hasOwn(row, 'priceUsd'));
    assert.ok(!Object.hasOwn(row, 'durationMins'));
  }
});

test('reutiliza las fichas existentes y no cambia activacion ni prioridad', () => {
  const row = { id: 'kids', title: ' Limpieza facial KIDS ', content: 'Texto anterior', active: false, priority: 90 };
  const plan = planInformation([row]);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.create.length, 10);
  assert.equal(plan.update[0].row, row);
  assert.deepEqual(Object.keys(plan.update[0]), ['row', 'content']);
});

test('rechaza textos ausentes y fichas duplicadas antes de escribir', () => {
  assert.throws(() => planInformation([], []), /ausente o ambiguo/);
  assert.throws(() => planInformation([{ title: 'Terapia de sonido' }, { title: 'terapia de sonido' }]), /duplicada/);
});

function mockDatabase({ concurrentChange = false } = {}) {
  const rows = [{ id: 'kids', title: 'Limpieza facial kids', content: 'Texto anterior', category: 'Faciales', active: true, priority: 70, source: 'Catalogo', updatedAt: new Date() }];
  const writes = [];
  const audits = [];
  const db = {
    tenant: { findUnique: async () => ({ id: 'alma-id', name: 'Alma Spa' }) },
    almitaKnowledge: {
      findMany: async ({ where }) => { assert.equal(where.tenantId, 'alma-id'); return rows.map((row) => ({ ...row })); },
      updateMany: async (args) => {
        writes.push(args);
        if (concurrentChange) return { count: 0 };
        rows.find((row) => row.id === args.where.id).content = args.data.content;
        return { count: 1 };
      },
      create: async ({ data }) => { writes.push(data); rows.push(data); return data; },
    },
    adminAuditLog: { create: async ({ data }) => { audits.push(data); return data; } },
    $transaction: async (fn) => fn(db),
  };
  return { db, rows, writes, audits };
}

test('la vista previa no escribe y la aplicacion exige el tenant verificado', async () => {
  const { db, writes } = mockDatabase();
  const result = await applyInformation(db);
  assert.equal(result.created.length, 10);
  assert.equal(result.updated.length, 1);
  await assert.rejects(applyInformation(db, { apply: true }), /tenant-id/);
  await assert.rejects(applyInformation(db, { apply: true, expectedTenantId: 'otro-tenant' }), /no coincide/);
  assert.equal(writes.length, 0);
});

test('aplica y audita solo informacion; repetir no duplica ni sobrescribe', async () => {
  const { db, rows, writes, audits } = mockDatabase();
  const result = await applyInformation(db, { apply: true, expectedTenantId: 'alma-id' });
  assert.equal(result.created.length, 10);
  assert.equal(result.updated.length, 1);
  assert.equal(rows.length, 11);
  assert.deepEqual(Object.keys(writes[0].data), ['content']);
  assert.equal(rows[0].priority, 70);
  assert.equal(rows[0].source, 'Catalogo');
  assert.equal(audits.length, 11);
  assert.equal(audits[0].detail.previousContent, 'Texto anterior');
  const again = await applyInformation(db, { apply: true, expectedTenantId: 'alma-id' });
  assert.equal(again.created.length, 0);
  assert.equal(again.updated.length, 0);
  assert.equal(writes.length, 11);
  assert.equal(audits.length, 11);
});

test('una edicion concurrente impide sobrescribir el contenido', async () => {
  const { db, audits } = mockDatabase({ concurrentChange: true });
  await assert.rejects(applyInformation(db, { apply: true, expectedTenantId: 'alma-id' }), /cambio durante la carga/);
  assert.equal(audits.length, 0);
});
