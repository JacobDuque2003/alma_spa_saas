// Safe, one-off client-data cleanup for a single tenant.
//
// It deliberately preserves users, services, rooms, plans, categories,
// tenant configuration and the WhatsApp connection. The affected clients and
// their dependent reservations and treatment records are backed up locally
// before the all-or-nothing deletion transaction. CRM conversations/messages
// and compliance audit records are deliberately preserved: conversations are
// simply unlinked from the deleted client.
//
// Usage:
//   node scripts/maintenance/cleanup-clients-only.js
//   node scripts/maintenance/cleanup-clients-only.js --confirm
// Optional:
//   CLEAN_TENANT_SLUG=alma-spa node scripts/maintenance/cleanup-clients-only.js --confirm

const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const tenantSlug = process.env.CLEAN_TENANT_SLUG || 'alma-spa';
const confirmed = process.argv.includes('--confirm');
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL or MIGRATION_DATABASE_URL must be set. Aborting.');
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

function backupPath() {
  const safeTime = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), 'backups', 'clients-only', `${tenantSlug}-${safeTime}.json`);
}

async function loadTargetData(tenantId) {
  const clients = await prisma.client.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  const clientIds = clients.map((client) => client.id);
  const clientFilter = { tenantId, clientId: { in: clientIds } };

  const conversations = clientIds.length
    ? await prisma.whatsAppConversation.findMany({ where: clientFilter, orderBy: { createdAt: 'asc' } })
    : [];
  const conversationIds = conversations.map((conversation) => conversation.id);
  const conversationFilter = { tenantId, conversationId: { in: conversationIds } };

  const [
    intakes,
    intakeAuditLogs,
    appointments,
    treatmentHistories,
    clientPlans,
    ledgerEntries,
    messages,
    notes,
    botInteractionLogs,
  ] = await Promise.all([
    prisma.clientIntake.findMany({ where: clientFilter }),
    prisma.clientIntakeAuditLog.findMany({ where: clientFilter }),
    prisma.appointment.findMany({ where: clientFilter }),
    prisma.treatmentHistory.findMany({ where: clientFilter }),
    prisma.clientPlan.findMany({ where: clientFilter }),
    prisma.clientLedgerEntry.findMany({ where: clientFilter }),
    conversationIds.length ? prisma.whatsAppMessage.findMany({ where: conversationFilter }) : [],
    conversationIds.length ? prisma.whatsAppNote.findMany({ where: conversationFilter }) : [],
    conversationIds.length ? prisma.botInteractionLog.findMany({ where: conversationFilter }) : [],
  ]);

  return {
    exportedAt: new Date().toISOString(),
    scope: 'clients-only',
    tenant: { id: tenantId, slug: tenantSlug },
    clients,
    clientIntakes: intakes,
    clientIntakeAuditLogs: intakeAuditLogs,
    appointments,
    treatmentHistories,
    clientPlans,
    clientLedgerEntries: ledgerEntries,
    whatsappConversations: conversations,
    whatsappMessages: messages,
    whatsappNotes: notes,
    botInteractionLogs,
  };
}

function counts(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot)
      .filter(([, value]) => Array.isArray(value))
      .map(([name, value]) => [name, value.length]),
  );
}

function writeBackup(snapshot) {
  const target = backupPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', flag: 'wx' });
  return target;
}

async function deleteTargetData(tx, tenantId, clientIds) {
  const clientFilter = { tenantId, clientId: { in: clientIds } };
  const results = {};

  // Keep chats, notes, messages, bot logs and append-only audit logs. They are
  // outside a client-only cleanup, so only remove the optional client link.
  results.whatsappConversationsUnlinked = clientIds.length
    ? (await tx.whatsAppConversation.updateMany({ where: clientFilter, data: { clientId: null } })).count
    : 0;
  results.clientLedgerEntries = (await tx.clientLedgerEntry.deleteMany({ where: clientFilter })).count;
  results.treatmentHistories = (await tx.treatmentHistory.deleteMany({ where: clientFilter })).count;
  results.clientPlans = (await tx.clientPlan.deleteMany({ where: clientFilter })).count;
  results.appointments = (await tx.appointment.deleteMany({ where: clientFilter })).count;
  results.clientIntakes = (await tx.clientIntake.deleteMany({ where: clientFilter })).count;
  results.clients = (await tx.client.deleteMany({ where: { tenantId, id: { in: clientIds } } })).count;
  return results;
}

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) throw new Error(`Tenant '${tenantSlug}' not found.`);

  const snapshot = await loadTargetData(tenant.id);
  const clientIds = snapshot.clients.map((client) => client.id);

  console.log(`Tenant target: ${tenant.name} (${tenant.slug})`);
  console.log('Data targeted (nothing else is included):');
  console.log(JSON.stringify(counts(snapshot), null, 2));

  if (!confirmed) {
    console.log('\nDry run only. Pass --confirm to create the backup and execute the transaction.');
    return;
  }

  const targetBackup = writeBackup(snapshot);
  console.log(`Local backup created: ${targetBackup}`);

  const deleted = await prisma.$transaction(
    (tx) => deleteTargetData(tx, tenant.id, clientIds),
    { maxWait: 15_000, timeout: 60_000 },
  );
  console.log('Rows deleted:');
  console.log(JSON.stringify(deleted, null, 2));

  const remaining = await prisma.client.count({ where: { tenantId: tenant.id } });
  if (remaining !== 0) throw new Error(`Cleanup incomplete: ${remaining} clients remain in ${tenant.slug}.`);
  console.log('Verification OK: 0 clients remain. Chats/audit logs, services, rooms, users and tenant configuration were not targeted.');
}

main()
  .catch((error) => {
    console.error('CLIENT CLEANUP FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
