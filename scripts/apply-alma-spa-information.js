const { createHash } = require('node:crypto');
const approved = require('../docs/descripciones-servicios-aprobadas.json');
const { _internals: { validateKnowledge } } = require('../src/services/almitaCenterService');
const { writeAuditLog } = require('../src/utils/adminAudit');

const CATEGORIES = {
  'Limpieza facial kids': 'Faciales',
  'Limpieza facial profunda': 'Faciales',
  'Hidratación de labios': 'Faciales',
  'Terapia de sonido': 'Terapias',
  'Paquete détox y reducción consciente': 'Paquetes',
  'Paquete détox facial': 'Paquetes',
  'Paquete alivio profundo': 'Paquetes',
  'Baño de cajón': 'Bienestar',
  Maderoterapia: 'Corporales',
  'Envoltura corporal con vendas frías': 'Corporales',
  'Exfoliación corporal': 'Corporales',
};

const key = (value) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');

function planInformation(rows, entries = approved) {
  const plan = { create: [], update: [], unchanged: [] };
  for (const [title, category] of Object.entries(CATEGORIES)) {
    const matches = entries.filter((entry) => key(entry.name) === key(title));
    if (matches.length !== 1) throw new Error(`Texto aprobado ausente o ambiguo: ${title}`);
    const data = validateKnowledge({ title, category, content: matches[0].description, source: 'Descripciones aprobadas por Gianella', priority: 60, active: true });
    const existing = rows.filter((row) => key(row.title) === key(title));
    if (existing.length > 1) throw new Error(`Ficha informativa duplicada: ${title}`);
    if (!existing.length) plan.create.push(data);
    else if (existing[0].content !== data.content) plan.update.push({ row: existing[0], content: data.content });
    else plan.unchanged.push(title);
  }
  return plan;
}

async function applyInformation(prisma, { apply = false, expectedTenantId } = {}) {
  if (apply && !expectedTenantId) throw new Error('La aplicacion requiere --tenant-id verificado');
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'alma-spa' }, select: { id: true, name: true } });
  if (!tenant || (expectedTenantId && tenant.id !== expectedTenantId)) throw new Error('El tenant no coincide con Alma Spa');

  async function run(db) {
    const rows = await db.almitaKnowledge.findMany({ where: { tenantId: tenant.id } });
    const plan = planInformation(rows);
    if (apply) {
      const actor = { id: 'system:approved-almita-information', email: 'system', tenantId: tenant.id };
      async function audit(id, title, content, previousContent) {
        await writeAuditLog(db, {
          actor, entity: 'tenant', entityId: tenant.id, action: 'update',
          detail: { operation: 'almita-information-description', knowledgeId: id, title, content, previousContent, source: 'descripciones-servicios-aprobadas.json' },
        });
      }
      for (const { row, content } of plan.update) {
        const result = await db.almitaKnowledge.updateMany({ where: { id: row.id, tenantId: tenant.id, updatedAt: row.updatedAt, content: row.content }, data: { content } });
        if (result.count !== 1) throw new Error(`La ficha cambio durante la carga: ${row.title}`);
        await audit(row.id, row.title, content, row.content);
      }
      for (const data of plan.create) {
        // El ID estable impide que dos cargas simultaneas creen la misma ficha.
        const id = `almita_info_${createHash('sha256').update(`${tenant.id}:${key(data.title)}`).digest('hex').slice(0, 32)}`;
        await db.almitaKnowledge.create({ data: { id, tenantId: tenant.id, ...data } });
        await audit(id, data.title, data.content, null);
      }
      const after = planInformation(await db.almitaKnowledge.findMany({ where: { tenantId: tenant.id } }));
      if (after.create.length || after.update.length || after.unchanged.length !== 11) throw new Error('La verificacion de las fichas informativas fallo');
    }
    return { mode: apply ? 'applied' : 'dry-run', tenant, created: plan.create.map((row) => row.title), updated: plan.update.map(({ row }) => row.title), unchanged: plan.unchanged };
  }
  return apply ? prisma.$transaction(run, { timeout: 60000 }) : run(prisma);
}

async function main() {
  require('dotenv').config({ quiet: true });
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply' && !arg.startsWith('--tenant-id='))) throw new Error('Argumento no reconocido');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    console.log(JSON.stringify(await applyInformation(prisma, { apply: args.includes('--apply'), expectedTenantId: args.find((arg) => arg.startsWith('--tenant-id='))?.slice('--tenant-id='.length) }), null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((error) => { console.error(error.code ? `No se pudo completar la carga (${error.code})` : error.message); process.exitCode = 1; });

module.exports = { planInformation, applyInformation };
