require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const SEED_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'CambiarEnProduccion123!';

async function upsertUser({ email, name, role, tenantId, isProtected }) {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  return prisma.user.upsert({
    where: { email },
    update: { name, role, tenantId, isProtected },
    create: { email, name, role, tenantId, isProtected, passwordHash },
  });
}

async function main() {
  console.log('Seeding database...');

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'alma-spa' },
    update: { name: 'Alma Spa' },
    create: { slug: 'alma-spa', name: 'Alma Spa', plan: 'trial' },
  });
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const superadmin = await upsertUser({
    email: process.env.SEED_SUPERADMIN_EMAIL || 'admin@nuvio.tech',
    name: 'Superadmin NUVIO',
    role: 'superadmin',
    tenantId: null,
    isProtected: true,
  });
  console.log(`Superadmin (protegido): ${superadmin.email}`);

  const owner = await upsertUser({
    email: 'dueno@almaspa.test',
    name: 'Dueña Alma Spa',
    role: 'dueno',
    tenantId: tenant.id,
    isProtected: false,
  });
  console.log(`Dueño: ${owner.email}`);

  const recepcionista = await upsertUser({
    email: 'recepcion@almaspa.test',
    name: 'Recepción',
    role: 'personal',
    tenantId: tenant.id,
    isProtected: false,
  });
  await prisma.rolePermission.upsert({
    where: { userId: recepcionista.id },
    update: { agenda: true, gabinetes: true, clientes: true, crm: true },
    create: {
      userId: recepcionista.id,
      agenda: true,
      gabinetes: true,
      clientes: true,
      crm: true,
      reportes: false,
      configuracion: false,
    },
  });
  console.log(`Personal (recepción): ${recepcionista.email} — agenda/gabinetes/clientes/crm`);

  const terapeuta = await upsertUser({
    email: 'terapeuta@almaspa.test',
    name: 'Terapeuta',
    role: 'personal',
    tenantId: tenant.id,
    isProtected: false,
  });
  await prisma.rolePermission.upsert({
    where: { userId: terapeuta.id },
    update: { agenda: true, clientes: true },
    create: {
      userId: terapeuta.id,
      agenda: true,
      gabinetes: false,
      clientes: true,
      crm: false,
      reportes: false,
      configuracion: false,
    },
  });
  console.log(`Personal (terapeuta): ${terapeuta.email} — agenda/clientes`);

  console.log('\nSeed completado exitosamente.');
  console.log('\n--- Credenciales de prueba (misma password para todos) ---');
  console.log(`Password: ${SEED_PASSWORD}`);
  console.log(`Superadmin:  ${superadmin.email}`);
  console.log(`Dueño:       ${owner.email}`);
  console.log(`Recepción:   ${recepcionista.email}`);
  console.log(`Terapeuta:   ${terapeuta.email}`);
  console.log(`Tenant slug: ${tenant.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
