require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { CABINS, SERVICES } = require('../src/config/almaSpaCatalog');

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.ALMA_TENANT_SLUG || 'alma-spa';
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`Tenant no encontrado: ${slug}`);

  const existingConfig = tenant.config || {};
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      config: {
        ...existingConfig,
        timezone: existingConfig.timezone || 'America/Guayaquil',
        businessHours: {
          morning: { start: '09:00', end: '12:00' },
          afternoon: { start: '15:00', end: '20:00' },
        },
        workDays: existingConfig.workDays || [1, 2, 3, 4, 5, 6],
        appointmentBufferMins: 15,
      },
    },
  });

  for (const cabin of CABINS) {
    await prisma.serviceCategory.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: cabin.specialty } },
      update: { active: true },
      create: { tenantId: tenant.id, name: cabin.specialty, active: true },
    });
  }
  for (const service of SERVICES) {
    await prisma.serviceCategory.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: service.category } },
      update: { active: true },
      create: { tenantId: tenant.id, name: service.category, active: true },
    });
  }

  const roomsByOrder = new Map();
  for (const cabin of CABINS) {
    const room = await prisma.room.upsert({
      where: { id: (await prisma.room.findFirst({ where: { tenantId: tenant.id, name: cabin.name }, select: { id: true } }))?.id || '__new__' },
      update: {
        specialty: cabin.specialty,
        sortOrder: cabin.sortOrder,
        opensAt: cabin.sortOrder === 7 ? '08:00' : '09:00',
        closesAt: cabin.sortOrder === 7 ? '17:00' : '20:00',
        schedule: cabin.schedule || null,
        active: true,
      },
      create: {
        tenantId: tenant.id,
        name: cabin.name,
        specialty: cabin.specialty,
        sortOrder: cabin.sortOrder,
        opensAt: cabin.sortOrder === 7 ? '08:00' : '09:00',
        closesAt: cabin.sortOrder === 7 ? '17:00' : '20:00',
        schedule: cabin.schedule || null,
        active: true,
      },
    });
    roomsByOrder.set(cabin.sortOrder, room);
  }

  for (const service of SERVICES) {
    const roomConnections = service.cabinOrders
      .map((order) => roomsByOrder.get(order))
      .filter(Boolean)
      .map((room) => ({ id: room.id }));
    const existing = await prisma.service.findFirst({
      where: { tenantId: tenant.id, name: { equals: service.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      await prisma.service.update({
        where: { id: existing.id },
        data: {
          category: service.category,
          durationMins: service.durationMins,
          bufferMins: 15,
          colorHex: service.colorHex,
          offersHomeService: false,
          active: true,
          rooms: { set: roomConnections },
        },
      });
    } else {
      await prisma.service.create({
        data: {
          tenantId: tenant.id,
          name: service.name,
          category: service.category,
          durationMins: service.durationMins,
          bufferMins: 15,
          colorHex: service.colorHex,
          priceUsd: 0,
          offersHomeService: false,
          active: true,
          rooms: { connect: roomConnections },
        },
      });
    }
  }

  console.log(`Catálogo aplicado para ${tenant.name}: ${CABINS.length} cabinas, ${SERVICES.length} servicios.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
