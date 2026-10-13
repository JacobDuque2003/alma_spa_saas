const approvedDescriptions = require('../docs/descripciones-servicios-aprobadas.json');
const { normalizeDescription } = require('../src/utils/serviceImage');
const { writeAuditLog } = require('../src/utils/adminAudit');

const TENANT_SLUG = 'alma-spa';
const SERVICE_SELECT = {
  id: true, tenantId: true, name: true, category: true, parentServiceId: true,
  durationMins: true, bufferMins: true, colorHex: true, priceUsd: true,
  offersHomeService: true, active: true, description: true, updatedAt: true,
  imageMimeType: true, imageUpdatedAt: true,
  rooms: { select: { id: true }, orderBy: { id: 'asc' } },
};

function nameKey(name) {
  return String(name).normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

function planDescriptions(services, entries = approvedDescriptions) {
  const byName = new Map();
  for (const entry of entries) {
    const description = normalizeDescription(entry.description);
    if (!description || description !== entry.description) throw new Error(`Descripcion invalida: ${entry.name}`);
    for (const name of [entry.name, ...(entry.aliases || [])]) {
      const key = nameKey(name);
      if (!key || byName.has(key)) throw new Error(`Nombre aprobado duplicado: ${name}`);
      byName.set(key, entry);
    }
  }

  const matched = new Set();
  const seen = new Set();
  const updates = [];
  const unchanged = [];
  for (const service of services) {
    const key = nameKey(service.name);
    if (seen.has(key)) throw new Error(`Servicio activo duplicado: ${service.name}`);
    seen.add(key);
    const entry = byName.get(key);
    if (!entry) throw new Error(`Servicio sin descripcion aprobada: ${service.name}`);
    matched.add(entry);
    if (service.description === entry.description) unchanged.push(service.name);
    else updates.push({ service, description: entry.description });
  }
  return { updates, unchanged, notRegistered: entries.filter((entry) => !matched.has(entry)).map((entry) => entry.name) };
}

function protectedFields(service) {
  const { description, updatedAt, ...rest } = service;
  return JSON.stringify(rest);
}

async function applyDescriptions(prisma, { apply = false, expectedTenantId } = {}) {
  if (apply && !expectedTenantId) throw new Error('La aplicacion requiere --tenant-id con el ID verificado de Alma Spa');
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG }, select: { id: true, name: true, slug: true } });
  if (!tenant || (expectedTenantId && tenant.id !== expectedTenantId)) throw new Error('El tenant no coincide con Alma Spa');

  async function run(db) {
    const services = await db.service.findMany({ where: { tenantId: tenant.id, active: true }, select: SERVICE_SELECT, orderBy: { name: 'asc' } });
    if (!services.length) throw new Error('Alma Spa no tiene servicios activos');
    const plan = planDescriptions(services);
    if (apply) {
      for (const { service, description } of plan.updates) {
        // Una edicion concurrente cancela el lote completo en lugar de sobrescribirla.
        const result = await db.service.updateMany({
          where: { id: service.id, tenantId: tenant.id, active: true, updatedAt: service.updatedAt, description: service.description },
          data: { description },
        });
        if (result.count !== 1) throw new Error(`El servicio cambio durante la carga: ${service.name}`);
        await writeAuditLog(db, {
          actor: { id: 'system:approved-service-descriptions', email: 'system', tenantId: tenant.id },
          entity: 'service', entityId: service.id, action: 'update',
          detail: { description, previousDescription: service.description, source: 'descripciones-servicios-aprobadas.json', approval: 'Aprobacion comunicada por el usuario en el chat' },
        });
      }
      const after = await db.service.findMany({ where: { tenantId: tenant.id, active: true }, select: SERVICE_SELECT, orderBy: { name: 'asc' } });
      if (planDescriptions(after).updates.length || after.length !== services.length) throw new Error('La verificacion de descripciones fallo');
      const beforeById = new Map(services.map((service) => [service.id, service]));
      for (const service of after) {
        if (protectedFields(service) !== protectedFields(beforeById.get(service.id))) throw new Error('Se modificaron campos ajenos a la descripcion');
      }
    }
    return {
      mode: apply ? 'applied' : 'dry-run', tenant, totalServices: services.length,
      updated: plan.updates.map(({ service }) => service.name), unchanged: plan.unchanged,
      notRegistered: plan.notRegistered,
    };
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
    const result = await applyDescriptions(prisma, { apply: args.includes('--apply'), expectedTenantId: args.find((arg) => arg.startsWith('--tenant-id='))?.slice('--tenant-id='.length) });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.code ? `No se pudo completar la carga (${error.code})` : error.message);
    process.exitCode = 1;
  });
}

module.exports = { planDescriptions, applyDescriptions };
