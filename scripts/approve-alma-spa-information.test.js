const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planInformation } = require('./apply-alma-spa-information');
const { planApproval, approveInformation } = require('./approve-alma-spa-information');

function fixture() {
  const rows = planInformation([]).create.map((row, i) => ({ ...row, id: `k${i}`, audience: 'INTERNAL', updatedAt: new Date() }));
  rows.push({ id: 'private', title: 'Notas de soporte', content: 'PRIVATE-SYNTHETIC', active: true, audience: 'INTERNAL' });
  const audits = [];
  const db = {
    tenant: { findUnique: async () => ({ id: 't1', slug: 'alma-spa' }) },
    almitaKnowledge: {
      findMany: async () => rows.map((row) => ({ ...row })),
      updateMany: async ({ where, data }) => {
        assert.equal(where.tenantId, 't1'); assert.equal(where.audience, 'INTERNAL');
        const row = rows.find((item) => item.id === where.id && item.content === where.content);
        if (!row) return { count: 0 };
        assert.deepEqual(data, { audience: 'PUBLIC' }); row.audience = data.audience; return { count: 1 };
      },
    },
    adminAuditLog: { create: async ({ data }) => { audits.push(data); } },
    $transaction: async (fn) => fn(db),
  };
  return { db, rows, audits };
}

test('solo planifica los once textos exactos aprobados', () => {
  const { rows } = fixture();
  const plan = planApproval(rows);
  assert.equal(plan.length, 11); assert.ok(!plan.some(({ row }) => row.id === 'private'));
  rows[0].content += ' edicion no aprobada';
  assert.throws(() => planApproval(rows), /Texto distinto/);
});
test('rechaza duplicados, ausentes e inactivos', () => {
  const { rows } = fixture();
  assert.throws(() => planApproval(rows.slice(1)), /ausente/);
  assert.throws(() => planApproval([...rows, rows[0]]), /duplicada/);
  rows[0].active = false; assert.throws(() => planApproval(rows), /inactiva/);
});
test('dry-run no escribe y aplicar exige tenant exacto', async () => {
  const { db, rows, audits } = fixture();
  assert.equal((await approveInformation(db)).approved.length, 11);
  assert.equal(rows[0].audience, 'INTERNAL'); assert.equal(audits.length, 0);
  await assert.rejects(() => approveInformation(db, { apply: true }), /tenant-id/);
  await assert.rejects(() => approveInformation(db, { apply: true, expectedTenantId: 't2' }), /Tenant distinto/);
});
test('aprobacion auditable e idempotente no publica notas internas ni cambia textos', async () => {
  const { db, rows, audits } = fixture(); const contents = rows.map((row) => row.content);
  assert.equal((await approveInformation(db, { apply: true, expectedTenantId: 't1' })).approved.length, 11);
  assert.equal(audits.length, 11); assert.equal(rows.at(-1).audience, 'INTERNAL');
  assert.deepEqual(rows.map((row) => row.content), contents);
  assert.ok(audits.every((row) => /^[a-f0-9]{64}$/.test(row.detail.contentHash)));
  assert.equal((await approveInformation(db, { apply: true, expectedTenantId: 't1' })).approved.length, 0);
  assert.equal(audits.length, 11);
});
test('no aprueba si la ficha cambia concurrentemente', async () => {
  const { db, audits } = fixture(); db.almitaKnowledge.updateMany = async () => ({ count: 0 });
  await assert.rejects(() => approveInformation(db, { apply: true, expectedTenantId: 't1' }), /cambio durante/);
  assert.equal(audits.length, 0);
});
