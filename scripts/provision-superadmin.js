require('dotenv').config();

const bcrypt = require('bcryptjs');
const prisma = require('../src/utils/prisma');

const email = (process.env.SUPERADMIN_EMAIL || 'admin@alma.local').trim().toLowerCase();
const name = (process.env.SUPERADMIN_NAME || 'Admin de Mantenimiento').trim();
const password = process.env.SUPERADMIN_BOOTSTRAP_PASSWORD || '';

async function main() {
  if (process.env.CONFIRM_PROVISION_SUPERADMIN !== 'yes') {
    throw new Error('Protección activa: define CONFIRM_PROVISION_SUPERADMIN=yes para crear o rotar esta cuenta.');
  }
  if (!password || password.length < 32) {
    throw new Error('SUPERADMIN_BOOTSTRAP_PASSWORD debe ser un token de al menos 32 caracteres.');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !existing.isProtected) {
    throw new Error('Ya existe una cuenta no protegida con este correo. Elige otro SUPERADMIN_EMAIL; no se elevará una cuenta existente.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      role: 'superadmin',
      tenantId: null,
      isProtected: true,
      active: true,
      canAttendAppointments: false,
      accessSchedule: { alwaysAllowed: true },
    },
    create: {
      email,
      name,
      passwordHash,
      role: 'superadmin',
      tenantId: null,
      isProtected: true,
      active: true,
      canAttendAppointments: false,
      accessSchedule: { alwaysAllowed: true },
    },
    select: { email: true, name: true, role: true, isProtected: true, active: true },
  });

  console.log(`Cuenta de mantenimiento lista: ${user.email} (${user.role}, protegida=${user.isProtected}, activa=${user.active})`);
}

main()
  .catch((error) => {
    console.error(`[provision-superadmin] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
