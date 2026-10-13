const test = require('node:test');
const assert = require('node:assert/strict');
const entries = require('../docs/descripciones-servicios-aprobadas.json');
const { planDescriptions, applyDescriptions } = require('./apply-alma-spa-descriptions');

test('todos los textos aprobados caben en 500 caracteres y sus nombres son unicos', () => {
  assert.equal(entries.length, 39);
  const services = entries.map((entry, index) => ({ id: String(index), name: entry.name, description: null }));
  assert.equal(planDescriptions(services).updates.length, 39);
  assert.ok(entries.every((entry) => entry.description.length <= 500));
});

test('Depilacion conserva su nombre y recibe el texto aprobado para laser diodo', () => {
  const service = { id: 'laser', name: 'Depilación', description: null };
  const plan = planDescriptions([service]);
  assert.equal(plan.updates[0].service.name, 'Depilación');
  assert.equal(plan.updates[0].description, entries.find((entry) => entry.name === 'Depilación con láser diodo').description);
  assert.equal(plan.notRegistered.length, 38);
});

test('una segunda carga no vuelve a escribir textos iguales', () => {
  const plan = planDescriptions([{ name: entries[0].name, description: entries[0].description }]);
  assert.equal(plan.updates.length, 0);
  assert.deepEqual(plan.unchanged, [entries[0].name]);
});

test('no se adivinan coincidencias parciales ni se aceptan nombres ambiguos', () => {
  assert.throws(() => planDescriptions([{ name: 'Masaje', description: null }]), /sin descripcion aprobada/);
  assert.throws(() => planDescriptions([{ name: 'Aero yoga' }, { name: ' aero YOGA ' }]), /duplicado/);
  assert.throws(() => planDescriptions([], [{ name: 'Facial', description: 'x'.repeat(501) }]), /description/);
});

function mockDatabase({ concurrentChange = false } = {}) {
  const tenant = { id: 'alma-id', name: 'Alma Spa', slug: 'alma-spa' };
  const row = { id: 's1', tenantId: tenant.id, name: 'Camilla Ceragem', description: 'Limpieza y extracción profunda', updatedAt: new Date('2026-10-12T12:00:00Z'), priceUsd: '30', durationMins: 60, rooms: [{ id: 'room' }] };
  const writes = [];
  const audits = [];
  const db = {
    tenant: { findUnique: async () => tenant },
    service: {
      findMany: async ({ where }) => { assert.equal(where.tenantId, tenant.id); assert.equal(where.active, true); return [{ ...row }]; },
      updateMany: async (args) => {
        writes.push(args);
        if (concurrentChange) return { count: 0 };
        row.description = args.data.description;
        return { count: 1 };
      },
    },
    adminAuditLog: { create: async ({ data }) => { audits.push(data); return data; } },
    $transaction: async (fn) => fn(db),
  };
  return { db, writes, audits };
}

test('la vista previa no modifica servicios ni auditoria ni crea ofertas nuevas', async () => {
  const { db, writes, audits } = mockDatabase();
  const result = await applyDescriptions(db);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.updated.length, 1);
  assert.equal(result.notRegistered.length, 38);
  assert.equal(writes.length, 0);
  assert.equal(audits.length, 0);
});

test('la carga solo escribe description y audita el texto anterior por tenant', async () => {
  const { db, writes, audits } = mockDatabase();
  const result = await applyDescriptions(db, { apply: true, expectedTenantId: 'alma-id' });
  assert.equal(result.mode, 'applied');
  assert.deepEqual(Object.keys(writes[0].data), ['description']);
  assert.equal(writes[0].where.tenantId, 'alma-id');
  assert.equal(writes[0].where.description, 'Limpieza y extracción profunda');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].tenantId, 'alma-id');
  assert.equal(audits[0].detail.previousDescription, 'Limpieza y extracción profunda');
});

test('requiere el tenant verificado y cancela ante modificaciones concurrentes', async () => {
  const { db, writes } = mockDatabase({ concurrentChange: true });
  await assert.rejects(applyDescriptions(db, { apply: true }), /requiere --tenant-id/);
  await assert.rejects(applyDescriptions(db, { apply: true, expectedTenantId: 'otro-tenant' }), /no coincide/);
  assert.equal(writes.length, 0);
  await assert.rejects(applyDescriptions(db, { apply: true, expectedTenantId: 'alma-id' }), /cambio durante la carga/);
});
