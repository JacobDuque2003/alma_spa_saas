// prisma/cleanProductionData.js
//
// One-shot destructive cleanup executed on 2026-07-31 to prepare the Alma Spa
// production tenant for the owner's demo (P1-C). Preserved verbatim in the repo
// for reproducibility and audit.
//
// Behavior:
//   node prisma/cleanProductionData.js            → dry-run: prints counts, deletes NOTHING.
//   node prisma/cleanProductionData.js --confirm  → executes the delete transaction.
//
// Uses MIGRATION_DATABASE_URL (postgres superuser) because the runtime role
// `alma_app` deliberately has no DELETE on ClientIntakeAuditLog (append-only
// guarantee from Fase 4 / Oleada 1). This is the two-URL design at work.
//
// The single Prisma $transaction is all-or-nothing. A FK error rolls back
// every step. Verify counts before/after.

const { PrismaClient } = require('@prisma/client');

if (!process.env.MIGRATION_DATABASE_URL) {
  console.error('MIGRATION_DATABASE_URL must be set. Aborting.');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.MIGRATION_DATABASE_URL } },
});

const TENANT_ID = process.env.CLEAN_TENANT_ID || 'cmr99z3jv0000j4ijwodukjen';
const TEST_EMAILS = [
  'dueno@almaspa.test',
  'recepcion@almaspa.test',
  'terapeuta@almaspa.test',
  'lucia.demo@alma-spa.ec',
];
const TENANT_TABLES = [
  'appointment', 'client', 'clientIntake', 'clientIntakeAuditLog',
  'clientPlan', 'clientLedgerEntry', 'treatmentHistory',
  'whatsAppConversation', 'whatsAppMessage', 'whatsAppConnection',
  'adminAuditLog', 'plan', 'room', 'service', 'serviceCategory', 'rolePermission',
];

async function snapshot() {
  const rows = {};
  for (const t of TENANT_TABLES) rows[t] = await prisma[t].count();
  rows.user = await prisma.user.count();
  return rows;
}

async function main() {
  const confirmed = process.argv.includes('--confirm');
  const tenant = await prisma.tenant.findUnique({
    where: { id: TENANT_ID },
    select: { id: true, slug: true, name: true, config: true },
  });
  if (!tenant) throw new Error(`Tenant ${TENANT_ID} not found.`);

  console.log(`Tenant target: ${tenant.name} (${tenant.slug})`);
  console.log('Tenant.config (must remain untouched):');
  console.log(JSON.stringify(tenant.config, null, 2));

  const before = await snapshot();
  console.log('\nCounts BEFORE:');
  console.log(JSON.stringify(before, null, 2));

  if (!confirmed) {
    console.log('\nDry-run. Pass --confirm to execute.');
    return;
  }

  const testUsers = await prisma.user.findMany({
    where: { tenantId: TENANT_ID, email: { in: TEST_EMAILS } },
    select: { id: true, email: true },
  });
  const testUserIds = testUsers.map((u) => u.id);
  console.log('\nTest users targeted:', testUsers);

  const deleted = await prisma.$transaction(
    async (tx) => {
      const d = {};
      d.whatsAppMessage      = (await tx.whatsAppMessage.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.whatsAppConversation = (await tx.whatsAppConversation.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.clientIntakeAuditLog = (await tx.clientIntakeAuditLog.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.clientLedgerEntry    = (await tx.clientLedgerEntry.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.treatmentHistory     = (await tx.treatmentHistory.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.clientPlan           = (await tx.clientPlan.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.appointment          = (await tx.appointment.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.clientIntake         = (await tx.clientIntake.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.client               = (await tx.client.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.plan                 = (await tx.plan.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.room                 = (await tx.room.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.service              = (await tx.service.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.serviceCategory      = (await tx.serviceCategory.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.adminAuditLog        = (await tx.adminAuditLog.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.whatsAppConnection   = (await tx.whatsAppConnection.deleteMany({ where: { tenantId: TENANT_ID } })).count;
      d.rolePermission       = (await tx.rolePermission.deleteMany({ where: { userId: { in: testUserIds } } })).count;
      d.user                 = (await tx.user.deleteMany({ where: { id: { in: testUserIds } } })).count;
      return d;
    },
    { maxWait: 15000, timeout: 60000 },
  );

  console.log('\nRows deleted per table:');
  console.log(JSON.stringify(deleted, null, 2));

  const after = await snapshot();
  console.log('\nCounts AFTER:');
  console.log(JSON.stringify(after, null, 2));

  const tenantAfter = await prisma.tenant.findUnique({
    where: { id: TENANT_ID },
    select: { config: true },
  });
  const configPreserved = JSON.stringify(tenant.config) === JSON.stringify(tenantAfter.config);
  console.log('\nTenant.config preserved:', configPreserved);
  if (!configPreserved) throw new Error('Tenant.config changed unexpectedly. Aborting.');
}

main()
  .catch((err) => { console.error('CLEAN FAIL:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
