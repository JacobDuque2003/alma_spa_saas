const { createHash } = require('node:crypto');
const { planInformation } = require('./apply-alma-spa-information');
const { writeAuditLog } = require('../src/utils/adminAudit');

const normalize = (value) => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
const hash = (value) => createHash('sha256').update(value).digest('hex');

function planApproval(rows) {
  const approved = planInformation([]).create;
  return approved.map((expected) => {
    const matches = rows.filter((row) => normalize(row.title) === normalize(expected.title));
    if (matches.length !== 1) throw new Error(`Ficha ausente o duplicada: ${expected.title}`);
    const row = matches[0];
    if (row.content !== expected.content) throw new Error(`Texto distinto del aprobado: ${expected.title}`);
    if (row.active !== true) throw new Error(`Ficha inactiva: ${expected.title}`);
    return { row, title: expected.title, contentHash: hash(expected.content) };
  });
}

async function approveInformation(prisma, { apply = false, expectedTenantId } = {}) {
  if (apply && !expectedTenantId) throw new Error('La aprobacion requiere --tenant-id verificado');
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'alma-spa' }, select: { id: true, slug: true } });
  if (!tenant || (expectedTenantId && expectedTenantId !== tenant.id)) throw new Error('Tenant distinto de Alma Spa');
  async function run(db) {
    const rows = await db.almitaKnowledge.findMany({ where: { tenantId: tenant.id } });
    const plan = planApproval(rows);
    const pending = plan.filter(({ row }) => row.audience !== 'PUBLIC');
    if (apply) {
      for (const { row, title, contentHash } of pending) {
        const result = await db.almitaKnowledge.updateMany({
          where: { id: row.id, tenantId: tenant.id, content: row.content, updatedAt: row.updatedAt, active: true, audience: 'INTERNAL' },
          data: { audience: 'PUBLIC' },
        });
        if (result.count !== 1) throw new Error(`La ficha cambio durante la aprobacion: ${title}`);
        await writeAuditLog(db, {
          actor: { id: 'system:approved-public-information', email: 'system', tenantId: tenant.id },
          entity: 'tenant', entityId: tenant.id, action: 'update',
          detail: { operation: 'almita-information-public-approval', knowledgeId: row.id, title, contentHash, previousAudience: row.audience, audience: 'PUBLIC' },
        });
      }
      const after = planApproval(await db.almitaKnowledge.findMany({ where: { tenantId: tenant.id } }));
      if (after.some(({ row }) => row.audience !== 'PUBLIC')) throw new Error('La aprobacion no pudo verificarse');
    }
    return { mode: apply ? 'applied' : 'dry-run', tenant, approved: pending.map(({ title }) => title), alreadyPublic: plan.filter(({ row }) => row.audience === 'PUBLIC').map(({ title }) => title) };
  }
  return apply ? prisma.$transaction(run, { timeout: 30000 }) : run(prisma);
}

async function main() {
  require('dotenv').config({ quiet: true });
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply' && !arg.startsWith('--tenant-id='))) throw new Error('Argumento no reconocido');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    console.log(JSON.stringify(await approveInformation(prisma, { apply: args.includes('--apply'), expectedTenantId: args.find((arg) => arg.startsWith('--tenant-id='))?.slice(12) }), null, 2));
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((error) => { console.error(error.code ? `No se completo la aprobacion (${error.code})` : error.message); process.exitCode = 1; });
module.exports = { planApproval, approveInformation };
