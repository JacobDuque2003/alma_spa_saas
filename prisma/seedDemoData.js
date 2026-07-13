/**
 * seedDemoData.js — Datos de demostración para probar Reportes y CRM.
 *
 * NO reemplaza prisma/seed.js (seed mínimo estructural de Fase 1).
 * Este script AMPLÍA el tenant alma-spa con volumen realista:
 *   - 18 clientes (algunos con intake/anamnesis cifrada)
 *   - Citas repartidas en ~2.5 meses (mayo–julio 2026)
 *   - Historial de tratamientos con notas cifradas
 *   - Planes contratados en distintos estados
 *   - Movimientos de ledger coherentes
 *   - Conversaciones y mensajes de WhatsApp (inserción directa, no vía webhook)
 *
 * Ejecutar: node prisma/seedDemoData.js
 * Requiere: .env con DATABASE_URL e INTAKE_ENCRYPTION_KEY configurados.
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { encryptField } = require('../src/utils/intakeCrypto');
const { localHourToUTC, DEFAULT_TIMEZONE } = require('../src/utils/timezone');

const prisma = new PrismaClient();

const TID = 'cmr99z3jv0000j4ijwodukjen';
const DUENO_ID = 'cmr99z4em0004j4ijrax9gku2';
const RECEPCION_ID = 'cmr99z4qr0006j4ijz5atnd4e';
const TERAPEUTA1_ID = 'cmr99z5ev000aj4ijd4x5iz49';
const SERVICE_MASAJE = 'cmr9dmdix0001tyvoa2g1lop1';
const SERVICE_FACIAL = 'cmr9dmdrx0003tyvoyfq21l5y';
const ROOM_MASAJES = 'cmr9dme5i0005tyvowxqpj802';
const PLAN_MENSUAL = 'cmrckv8f0000i3rivbiecjrvq';

function d(dateStr, hour = 10) {
  return localHourToUTC(dateStr, hour, DEFAULT_TIMEZONE);
}

function addHours(date, h) {
  return new Date(date.getTime() + h * 3600000);
}

async function main() {
  console.log('🌱 Sembrando datos de demostración...\n');

  // --- Infrastructure additions ---
  const room2 = await prisma.room.upsert({
    where: { id: 'demo-room-facial' },
    update: {},
    create: { id: 'demo-room-facial', tenantId: TID, name: 'Gabinete de faciales', specialty: 'faciales', active: true },
  });

  const terapeuta2 = await prisma.user.upsert({
    where: { email: 'lucia.demo@alma-spa.ec' },
    update: {},
    create: {
      id: 'demo-terapeuta-lucia', tenantId: TID, email: 'lucia.demo@alma-spa.ec',
      passwordHash: '$2b$10$placeholder', name: 'Lucía Mendoza', role: 'personal',
      active: true, canAttendAppointments: true,
    },
  });
  await prisma.rolePermission.upsert({
    where: { userId: terapeuta2.id },
    update: {},
    create: { userId: terapeuta2.id, agenda: true, gabinetes: false, clientes: true, crm: true, reportes: false, configuracion: false },
  });

  const service3 = await prisma.service.upsert({
    where: { id: 'demo-service-drenaje' },
    update: {},
    create: { id: 'demo-service-drenaje', tenantId: TID, name: 'Drenaje linfático', category: 'masajes', durationMins: 60, priceUsd: 65, active: true },
  });

  const plan2 = await prisma.plan.upsert({
    where: { id: 'demo-plan-facial' },
    update: {},
    create: { id: 'demo-plan-facial', tenantId: TID, name: 'Plan facial 6 sesiones', sessionsIncluded: 6, period: 'trimestral', priceUsd: 180, appliesToAllServices: false, active: true },
  });
  // Link plan2 to facial service
  await prisma.plan.update({ where: { id: plan2.id }, data: { services: { connect: { id: SERVICE_FACIAL } } } });

  console.log('  ✓ Infraestructura: 2 gabinetes, 2 terapeutas, 3 servicios, 2 planes');

  // --- 18 Clients ---
  const clientData = [
    { fullName: 'María Fernanda López', whatsapp: '+593987654321' },
    { fullName: 'Andrea Castillo', whatsapp: '+593998877665' },
    { fullName: 'Carolina Ruiz Díaz', whatsapp: '+593976543210' },
    { fullName: 'Sofía Alejandra Torres', whatsapp: '+593965432109' },
    { fullName: 'Valentina Morales', whatsapp: '+593954321098' },
    { fullName: 'Camila Herrera', whatsapp: '+593943210987' },
    { fullName: 'Daniela Paredes', whatsapp: '+593932109876' },
    { fullName: 'Gabriela Suárez', whatsapp: '+593921098765' },
    { fullName: 'Natalia Vega', whatsapp: '+593910987654' },
    { fullName: 'Isabella Ramos', whatsapp: '+593909876543' },
    { fullName: 'Luciana Mendoza', whatsapp: '+593898765432' },
    { fullName: 'Paula Jiménez', whatsapp: '+593887654321' },
    { fullName: 'Alejandra Córdova', whatsapp: '+593876543210' },
    { fullName: 'Fernanda Aguirre', whatsapp: '+593865432109' },
    { fullName: 'Mariana Salazar', whatsapp: '+593854321098' },
    { fullName: 'Claudia Espinoza', whatsapp: '+593843210987' },
    { fullName: 'Verónica Lara', whatsapp: '+593832109876' },
    { fullName: 'Ana Belén Cueva', whatsapp: '+593821098765' },
  ];

  const clients = [];
  for (const cd of clientData) {
    const c = await prisma.client.upsert({
      where: { tenantId_whatsapp: { tenantId: TID, whatsapp: cd.whatsapp } },
      update: { fullName: cd.fullName },
      create: { tenantId: TID, fullName: cd.fullName, whatsapp: cd.whatsapp },
    });
    clients.push(c);
  }
  // Include Pedro García if he exists
  const pedro = await prisma.client.findFirst({ where: { tenantId: TID, fullName: { contains: 'Pedro' } } });
  if (pedro) clients.unshift(pedro);

  console.log(`  ✓ ${clients.length} clientes`);

  // --- Intake (anamnesis) for first 8 clients ---
  const allergies = ['Ninguna', 'Polen, ácaros', 'Mariscos', 'Ninguna', 'Penicilina', 'Látex', 'Ninguna', 'Fragancias fuertes'];
  const conditions = [
    'Estrés laboral crónico, contracturas cervicales frecuentes',
    'Rosácea leve, piel sensible. Evitar ácidos fuertes.',
    'Hipotiroidismo controlado, retención de líquidos',
    'Sin condiciones relevantes',
    'Embarazo 5 meses — evitar presión abdominal y aceites esenciales',
    'Fibromialgia diagnosticada, presión moderada solamente',
    'Acné hormonal en tratamiento dermatológico (isotretinoína)',
    'Varices en piernas, evitar presión directa en zonas afectadas',
  ];

  let intakeCount = 0;
  for (let i = 0; i < 8 && i < clients.length; i++) {
    const existing = await prisma.clientIntake.findUnique({ where: { clientId: clients[i].id } });
    if (existing) continue;

    const allergiesEnc = encryptField(allergies[i]);
    const conditionsEnc = encryptField(conditions[i]);
    await prisma.clientIntake.create({
      data: {
        tenantId: TID,
        clientId: clients[i].id,
        allergiesEnc: allergiesEnc.enc, allergiesIv: allergiesEnc.iv, allergiesTag: allergiesEnc.tag,
        conditionsEnc: conditionsEnc.enc, conditionsIv: conditionsEnc.iv, conditionsTag: conditionsEnc.tag,
        consentSigned: true,
        consentSignedAt: new Date('2026-05-01'),
      },
    });
    intakeCount++;
  }
  console.log(`  ✓ ${intakeCount} fichas de anamnesis (cifradas)`);

  // --- Appointments: spread May-July 2026 ---
  const staffIds = [TERAPEUTA1_ID, terapeuta2.id];
  const serviceIds = [SERVICE_MASAJE, SERVICE_FACIAL, service3.id];
  const servicePrices = { [SERVICE_MASAJE]: 50, [SERVICE_FACIAL]: 40, [service3.id]: 65 };
  const serviceRooms = { [SERVICE_MASAJE]: ROOM_MASAJES, [SERVICE_FACIAL]: room2.id, [service3.id]: ROOM_MASAJES };

  const appointments = [];

  // Generate ~60 appointments across May 1 - July 12
  const baseDate = new Date('2026-05-05');
  const today = new Date('2026-07-12');
  let apptIdx = 0;

  const schedule = [
    // May: 15 appointments (all confirmed, past)
    ...Array.from({ length: 15 }, (_, i) => ({
      date: '2026-05-' + String(5 + Math.floor(i * 1.7)).padStart(2, '0'),
      hour: 9 + (i % 4) * 2,
      status: 'confirmado',
    })),
    // June: 20 appointments (mostly confirmed, 2 cancelado, 2 no_show)
    ...Array.from({ length: 20 }, (_, i) => ({
      date: '2026-06-' + String(2 + Math.floor(i * 1.4)).padStart(2, '0'),
      hour: 9 + (i % 5) * 2,
      status: i === 5 || i === 12 ? 'cancelado' : i === 8 || i === 17 ? 'no_show' : 'confirmado',
    })),
    // July 1-11: 18 appointments (confirmed, 1 cancelado, 1 no_show)
    ...Array.from({ length: 18 }, (_, i) => ({
      date: '2026-07-' + String(1 + Math.floor(i * 0.6)).padStart(2, '0'),
      hour: 9 + (i % 4) * 2,
      status: i === 4 ? 'cancelado' : i === 9 ? 'no_show' : 'confirmado',
    })),
    // Today (July 12): 5 pendiente (for "sin confirmar hoy" filter) + 2 confirmado
    { date: '2026-07-12', hour: 10, status: 'pendiente' },
    { date: '2026-07-12', hour: 11, status: 'pendiente' },
    { date: '2026-07-12', hour: 14, status: 'pendiente' },
    { date: '2026-07-12', hour: 15, status: 'pendiente' },
    { date: '2026-07-12', hour: 16, status: 'pendiente' },
    { date: '2026-07-12', hour: 9, status: 'confirmado' },
    { date: '2026-07-12', hour: 13, status: 'confirmado' },
  ];

  for (const slot of schedule) {
    const clientIdx = apptIdx % clients.length;
    const serviceIdx = apptIdx % serviceIds.length;
    const staffIdx = apptIdx % staffIds.length;
    const serviceId = serviceIds[serviceIdx];
    const startsAt = d(slot.date, slot.hour);
    const endsAt = addHours(startsAt, 1);

    try {
      const appt = await prisma.appointment.create({
        data: {
          tenantId: TID,
          clientId: clients[clientIdx].id,
          serviceId,
          staffId: staffIds[staffIdx],
          roomId: serviceRooms[serviceId],
          startsAt,
          endsAt,
          status: slot.status,
          priceUsd: servicePrices[serviceId],
        },
      });
      appointments.push({ ...appt, serviceId, staffId: staffIds[staffIdx] });
    } catch (err) {
      // Skip unique constraint violations (room+startsAt or staff+startsAt)
      if (err.code === 'P2002') continue;
      throw err;
    }
    apptIdx++;
  }
  console.log(`  ✓ ${appointments.length} citas (may–jul 2026)`);

  // --- Treatment History for confirmed past appointments (first 25) ---
  const treatmentNotes = [
    'Zona lumbar con contractura importante. Se trabajó con presión media-alta. Paciente reporta alivio inmediato.',
    'Limpieza profunda con extracción. Piel reactiva en zona T. Se aplicó mascarilla calmante de avena.',
    'Drenaje de miembros inferiores. Retención moderada. Se recomendó aumentar hidratación.',
    'Masaje descontracturante cervical y escapular. Nódulos palpables en trapecio derecho.',
    'Facial hidratante. Piel deshidratada por exposición solar. Se recomendó SPF 50 diario.',
    'Sesión de relajación completa. Sin hallazgos clínicos relevantes. Paciente satisfecha.',
    'Drenaje post-quirúrgico (liposucción abdominal hace 3 semanas). Edema moderado en flancos.',
    'Masaje deportivo piernas. Paciente corre maratón en 2 semanas. Isquiotibiales tensos.',
    'Tratamiento anti-edad con vitamina C y ácido hialurónico. Buena tolerancia.',
    'Masaje prenatal. Posición lateral. Presión suave. Zona lumbar y piernas cansadas.',
  ];

  const confirmedPast = appointments.filter(a => a.status === 'confirmado' && a.startsAt < today);
  let treatmentCount = 0;
  for (let i = 0; i < Math.min(25, confirmedPast.length); i++) {
    const appt = confirmedPast[i];
    const notes = treatmentNotes[i % treatmentNotes.length];
    const notesEnc = encryptField(notes);

    await prisma.treatmentHistory.create({
      data: {
        tenantId: TID,
        clientId: appt.clientId,
        serviceId: appt.serviceId,
        therapistId: appt.staffId,
        createdById: appt.staffId,
        appointmentId: appt.id,
        sessionDate: appt.startsAt,
        notesEnc: notesEnc.enc, notesIv: notesEnc.iv, notesTag: notesEnc.tag,
        productsUsed: i % 3 === 0 ? ['Aceite de almendras', 'Crema caliente'] : i % 3 === 1 ? ['Ácido hialurónico', 'Vitamina C sérum'] : [],
      },
    });
    treatmentCount++;
  }
  console.log(`  ✓ ${treatmentCount} historiales de tratamiento (notas cifradas)`);

  // --- Client Plans ---
  const planClients = clients.slice(0, 6);
  let planCount = 0;

  // Plan 1: Recién contratado (0 sesiones usadas)
  const cp1 = await prisma.clientPlan.create({
    data: {
      tenantId: TID, clientId: planClients[0].id, planId: PLAN_MENSUAL,
      sessionsIncluded: 4, priceUsd: 80, periodMonths: 1,
      periodStart: new Date('2026-07-01'), renewsAt: new Date('2026-08-01'),
      sessionsUsed: 0,
    },
  });
  await prisma.clientLedgerEntry.create({
    data: { tenantId: TID, clientId: planClients[0].id, type: 'cargo', amountUsd: 80, description: 'Plan mensual masajes — contratación', createdById: DUENO_ID, clientPlanId: cp1.id },
  });
  planCount++;

  // Plan 2: Parcialmente usado (2/4 sesiones)
  const cp2 = await prisma.clientPlan.create({
    data: {
      tenantId: TID, clientId: planClients[1].id, planId: PLAN_MENSUAL,
      sessionsIncluded: 4, priceUsd: 80, periodMonths: 1,
      periodStart: new Date('2026-06-15'), renewsAt: new Date('2026-07-15'),
      sessionsUsed: 2,
    },
  });
  await prisma.clientLedgerEntry.create({
    data: { tenantId: TID, clientId: planClients[1].id, type: 'cargo', amountUsd: 80, description: 'Plan mensual masajes — contratación', createdById: DUENO_ID, clientPlanId: cp2.id },
  });
  planCount++;

  // Plan 3: Renovado (primer periodo agotado, segundo activo con 1/4)
  const cp3old = await prisma.clientPlan.create({
    data: {
      tenantId: TID, clientId: planClients[2].id, planId: PLAN_MENSUAL,
      sessionsIncluded: 4, priceUsd: 80, periodMonths: 1,
      periodStart: new Date('2026-05-15'), renewsAt: new Date('2026-06-15'),
      sessionsUsed: 4, active: false,
    },
  });
  await prisma.clientLedgerEntry.create({
    data: { tenantId: TID, clientId: planClients[2].id, type: 'cargo', amountUsd: 80, description: 'Plan mensual masajes — contratación', createdById: DUENO_ID, clientPlanId: cp3old.id, createdAt: new Date('2026-05-15') },
  });
  const cp3new = await prisma.clientPlan.create({
    data: {
      tenantId: TID, clientId: planClients[2].id, planId: PLAN_MENSUAL,
      sessionsIncluded: 4, priceUsd: 80, periodMonths: 1,
      periodStart: new Date('2026-06-15'), renewsAt: new Date('2026-07-15'),
      sessionsUsed: 1,
    },
  });
  await prisma.clientLedgerEntry.create({
    data: { tenantId: TID, clientId: planClients[2].id, type: 'cargo', amountUsd: 80, description: 'Plan mensual masajes — renovación', createdById: DUENO_ID, clientPlanId: cp3new.id, createdAt: new Date('2026-06-15') },
  });
  planCount += 2;

  // Plan 4: Plan facial (3/6 sesiones usadas)
  const cp4 = await prisma.clientPlan.create({
    data: {
      tenantId: TID, clientId: planClients[3].id, planId: plan2.id,
      sessionsIncluded: 6, priceUsd: 180, periodMonths: 3,
      periodStart: new Date('2026-05-01'), renewsAt: new Date('2026-08-01'),
      sessionsUsed: 3,
    },
  });
  await prisma.clientLedgerEntry.create({
    data: { tenantId: TID, clientId: planClients[3].id, type: 'cargo', amountUsd: 180, description: 'Plan facial 6 sesiones — contratación', createdById: DUENO_ID, clientPlanId: cp4.id, createdAt: new Date('2026-05-01') },
  });
  planCount++;

  // Plan 5: Cortesía (isComplimentary)
  const cp5 = await prisma.clientPlan.create({
    data: {
      tenantId: TID, clientId: planClients[4].id, planId: PLAN_MENSUAL,
      sessionsIncluded: 4, priceUsd: 0, periodMonths: 1,
      periodStart: new Date('2026-07-01'), renewsAt: new Date('2026-08-01'),
      sessionsUsed: 1, isComplimentary: true,
    },
  });
  planCount++;

  console.log(`  ✓ ${planCount} planes de cliente (distintos estados)`);

  // --- Ledger entries for individual appointments ---
  let ledgerCount = 0;
  const chargeableAppts = confirmedPast.slice(0, 30);
  for (const appt of chargeableAppts) {
    await prisma.clientLedgerEntry.create({
      data: {
        tenantId: TID, clientId: appt.clientId, type: 'cargo',
        amountUsd: servicePrices[appt.serviceId],
        description: `Servicio — cita ${appt.startsAt.toISOString().slice(0, 10)}`,
        createdById: DUENO_ID, appointmentId: appt.id,
        createdAt: appt.startsAt,
      },
    });
    ledgerCount++;
  }

  // Payments (some clients paid)
  for (let i = 0; i < 10; i++) {
    const client = clients[i % clients.length];
    await prisma.clientLedgerEntry.create({
      data: {
        tenantId: TID, clientId: client.id, type: 'pago',
        amountUsd: [50, 100, 80, 65, 40, 120, 50, 80, 65, 100][i],
        description: 'Pago en efectivo', method: i % 3 === 0 ? 'efectivo' : i % 3 === 1 ? 'transferencia' : 'tarjeta',
        createdById: RECEPCION_ID,
        createdAt: new Date('2026-06-' + String(10 + i).padStart(2, '0')),
      },
    });
    ledgerCount++;
  }

  // One reversal
  const firstCharge = await prisma.clientLedgerEntry.findFirst({
    where: { tenantId: TID, type: 'cargo', appointmentId: { not: null }, reversalOfId: null },
    orderBy: { createdAt: 'asc' },
  });
  if (firstCharge) {
    await prisma.clientLedgerEntry.create({
      data: {
        tenantId: TID, clientId: firstCharge.clientId, type: 'pago',
        amountUsd: firstCharge.amountUsd, description: `Reversa de ${firstCharge.id}`,
        createdById: DUENO_ID, reversalOfId: firstCharge.id,
      },
    });
    ledgerCount++;
  }

  console.log(`  ✓ ${ledgerCount} movimientos de ledger (cargos + pagos + 1 reversa)`);

  // --- WhatsApp Conversations & Messages ---
  // Direct insert (not via webhook) for demo purposes.
  const waClients = clients.slice(0, 10);
  let convCount = 0;
  let msgCount = 0;

  const sampleMessages = [
    ['Hola, quisiera agendar un masaje para esta semana', 'Con gusto, ¿qué día le queda mejor?', 'El jueves a las 10am si es posible'],
    ['Buenos días, ¿tienen disponibilidad para un facial?', '¡Sí! Tenemos espacio mañana a las 3pm', 'Perfecto, agendo para mañana entonces'],
    ['Me gustaría cancelar mi cita de mañana', 'Entendido, queda cancelada. ¿Desea reagendar?', 'Sí, la próxima semana por favor'],
    ['¿Cuánto cuesta el drenaje linfático?', 'El drenaje tiene un costo de $65 la sesión', 'Gracias, quiero agendar una'],
    ['Hola, ¿tienen planes mensuales?', 'Sí, el plan mensual incluye 4 sesiones por $80', 'Me interesa, ¿cómo me inscribo?'],
    ['¿A qué hora abren hoy?', 'Nuestro horario es de 9am a 7pm', '👍'],
    ['Quería confirmar mi cita de hoy', 'Confirmada, la esperamos a las 2pm', 'Gracias, ahí estaré'],
    ['¿Puedo cambiar mi cita del viernes al sábado?', 'Claro, el sábado tenemos espacio a las 11am', 'Listo, muchas gracias'],
    ['Hola, soy nueva. ¿Qué servicios ofrecen?', 'Ofrecemos masajes, faciales y drenaje linfático', '¿Puedo ir sin reserva?'],
    ['¿Tienen estacionamiento?', 'Sí, tenemos parqueadero gratuito para clientes', 'Perfecto'],
  ];

  for (let i = 0; i < waClients.length; i++) {
    const client = waClients[i];
    const customerWaId = client.whatsapp.replace(/^\+/, '');
    const msgs = sampleMessages[i];
    const isRead = i < 6; // first 6 read, last 4 unread
    const baseTime = new Date('2026-07-' + String(5 + i).padStart(2, '0') + 'T14:00:00Z');

    const conv = await prisma.whatsAppConversation.upsert({
      where: { tenantId_customerWaId: { tenantId: TID, customerWaId } },
      update: {},
      create: {
        tenantId: TID,
        clientId: client.id,
        customerWaId,
        customerName: client.fullName,
        lastInboundAt: new Date(baseTime.getTime() + 120000),
        lastOutboundAt: new Date(baseTime.getTime() + 60000),
        lastMessageAt: new Date(baseTime.getTime() + 120000),
        lastMessagePreview: msgs[msgs.length - 1].slice(0, 50),
        unreadCount: isRead ? 0 : (i % 3) + 1,
        lastReadAt: isRead ? new Date(baseTime.getTime() + 180000) : null,
      },
    });
    convCount++;

    // Create messages for this conversation
    for (let m = 0; m < msgs.length; m++) {
      const isInbound = m % 2 === 0; // alternate: client, spa, client
      const msgTime = new Date(baseTime.getTime() + m * 60000);
      await prisma.whatsAppMessage.create({
        data: {
          tenantId: TID,
          conversationId: conv.id,
          direction: isInbound ? 'inbound' : 'outbound',
          type: 'text',
          status: isInbound ? 'received' : 'delivered',
          body: msgs[m],
          waTimestamp: msgTime,
          sentByUserId: isInbound ? null : RECEPCION_ID,
        },
      });
      msgCount++;
    }
  }

  console.log(`  ✓ ${convCount} conversaciones WhatsApp, ${msgCount} mensajes`);

  // --- Summary ---
  console.log('\n📊 Resumen final:');
  const counts = {
    clients: await prisma.client.count({ where: { tenantId: TID } }),
    intakes: await prisma.clientIntake.count({ where: { tenantId: TID } }),
    appointments: await prisma.appointment.count({ where: { tenantId: TID } }),
    treatments: await prisma.treatmentHistory.count({ where: { tenantId: TID } }),
    clientPlans: await prisma.clientPlan.count({ where: { tenantId: TID } }),
    ledgerEntries: await prisma.clientLedgerEntry.count({ where: { tenantId: TID } }),
    conversations: await prisma.whatsAppConversation.count({ where: { tenantId: TID } }),
    messages: await prisma.whatsAppMessage.count({ where: { tenantId: TID } }),
    rooms: await prisma.room.count({ where: { tenantId: TID } }),
    services: await prisma.service.count({ where: { tenantId: TID } }),
    users: await prisma.user.count({ where: { tenantId: TID } }),
    plans: await prisma.plan.count({ where: { tenantId: TID } }),
  };

  console.log('  ' + Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' | '));

  const pendientesHoy = await prisma.appointment.count({
    where: { tenantId: TID, status: 'pendiente', startsAt: { gte: new Date('2026-07-12T00:00:00Z'), lt: new Date('2026-07-13T00:00:00Z') } },
  });
  console.log(`  Citas pendientes hoy (filtro "sin confirmar hoy"): ${pendientesHoy}`);

  const cancelados = await prisma.appointment.count({ where: { tenantId: TID, status: 'cancelado' } });
  const noShows = await prisma.appointment.count({ where: { tenantId: TID, status: 'no_show' } });
  console.log(`  Cancelaciones: ${cancelados} | No-show: ${noShows}`);

  const balance = await prisma.clientLedgerEntry.findMany({ where: { tenantId: TID } });
  const totalCargos = balance.filter(e => e.type === 'cargo').reduce((s, e) => s + Number(e.amountUsd), 0);
  const totalPagos = balance.filter(e => e.type === 'pago').reduce((s, e) => s + Number(e.amountUsd), 0);
  console.log(`  Ledger: $${totalCargos.toFixed(2)} en cargos, $${totalPagos.toFixed(2)} en pagos`);

  await prisma.$disconnect();
  console.log('\n✅ Seed de demostración completado.');
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
