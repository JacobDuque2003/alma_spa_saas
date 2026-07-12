const prisma = require('../utils/prisma');

const VALID_METRICS = [
  'ocupacion-gabinetes',
  'ingresos-servicio',
  'servicios-vendidos',
  'desempeno-terapeutas',
  'cancelaciones',
  'clientes-nuevos-recurrentes',
];

const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5, 6];
const DEFAULT_BUSINESS_HOURS = { start: '09:00', end: '19:00' };

function parseHoursRange(bh) {
  const start = bh?.start || DEFAULT_BUSINESS_HOURS.start;
  const end = bh?.end || DEFAULT_BUSINESS_HOURS.end;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em - sh * 60 - sm) / 60;
}

function countWorkDaysInRange(from, to, workDays) {
  let count = 0;
  const cursor = new Date(from);
  while (cursor < to) {
    const isoDay = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
    if (workDays.includes(isoDay)) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function previousPeriod(from, to) {
  const width = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - width), to: new Date(from.getTime()) };
}

async function getReport(tenantId, metric, from, to, actor) {
  const data = await computeMetric(tenantId, metric, from, to, actor);
  const prev = previousPeriod(from, to);
  const comparison = await computeMetric(tenantId, metric, prev.from, prev.to, actor);
  return {
    metric,
    from: from.toISOString(),
    to: to.toISOString(),
    data,
    comparison,
  };
}

async function computeMetric(tenantId, metric, from, to, actor) {
  switch (metric) {
    case 'ocupacion-gabinetes': return ocupacionGabinetes(tenantId, from, to);
    case 'ingresos-servicio': return ingresosServicio(tenantId, from, to);
    case 'servicios-vendidos': return serviciosVendidos(tenantId, from, to);
    case 'desempeno-terapeutas': return desempenoTerapeutas(tenantId, from, to, actor);
    case 'cancelaciones': return cancelaciones(tenantId, from, to);
    case 'clientes-nuevos-recurrentes': return clientesNuevosRecurrentes(tenantId, from, to);
    default: return null;
  }
}

async function ocupacionGabinetes(tenantId, from, to) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { config: true } });
  const config = tenant?.config || {};
  const workDays = Array.isArray(config.workDays) ? config.workDays : DEFAULT_WORK_DAYS;
  const hoursPerDay = parseHoursRange(config.businessHours);
  const workDaysCount = countWorkDaysInRange(from, to, workDays);

  const rooms = await prisma.room.findMany({
    where: { tenantId, active: true },
    select: { id: true, name: true, specialty: true },
  });

  const appointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      status: { in: ['pendiente', 'confirmado'] },
      roomId: { not: null },
      startsAt: { gte: from, lt: to },
    },
    select: { roomId: true, startsAt: true, endsAt: true },
  });

  const byRoom = {};
  for (const room of rooms) {
    byRoom[room.id] = { roomId: room.id, roomName: room.name, specialty: room.specialty, citasCount: 0, horasOcupadas: 0 };
  }
  for (const a of appointments) {
    if (!byRoom[a.roomId]) continue;
    byRoom[a.roomId].citasCount++;
    byRoom[a.roomId].horasOcupadas += (a.endsAt.getTime() - a.startsAt.getTime()) / 3600000;
  }

  const capacidadPorGabinete = hoursPerDay * workDaysCount;
  const result = Object.values(byRoom).map((r) => ({
    ...r,
    horasOcupadas: Math.round(r.horasOcupadas * 100) / 100,
    capacidadHoras: Math.round(capacidadPorGabinete * 100) / 100,
    porcentaje: capacidadPorGabinete > 0
      ? Math.round((r.horasOcupadas / capacidadPorGabinete) * 10000) / 100
      : 0,
  }));

  return {
    workDays,
    workDaysCount,
    hoursPerDay,
    gabinetes: result,
  };
}

async function ingresosServicio(tenantId, from, to) {
  const entries = await prisma.clientLedgerEntry.findMany({
    where: {
      tenantId,
      type: 'cargo',
      reversalOfId: null,
      createdAt: { gte: from, lt: to },
    },
    select: {
      amountUsd: true,
      appointmentId: true,
      treatmentHistoryId: true,
      clientPlanId: true,
    },
  });

  const planEntries = entries.filter((e) => e.clientPlanId != null);
  const nonPlanEntries = entries.filter((e) => e.clientPlanId == null);

  const appointmentIds = nonPlanEntries.filter((e) => e.appointmentId).map((e) => e.appointmentId);
  const treatmentIds = nonPlanEntries.filter((e) => !e.appointmentId && e.treatmentHistoryId).map((e) => e.treatmentHistoryId);

  const apptServiceMap = {};
  if (appointmentIds.length > 0) {
    const appts = await prisma.appointment.findMany({
      where: { id: { in: appointmentIds }, tenantId },
      select: { id: true, serviceId: true },
    });
    for (const a of appts) apptServiceMap[a.id] = a.serviceId;
  }

  const thServiceMap = {};
  if (treatmentIds.length > 0) {
    const ths = await prisma.treatmentHistory.findMany({
      where: { id: { in: treatmentIds }, tenantId },
      select: { id: true, serviceId: true },
    });
    for (const t of ths) thServiceMap[t.id] = t.serviceId;
  }

  const serviceAgg = {};
  const unattributed = { count: 0, totalUsd: 0 };

  for (const e of nonPlanEntries) {
    const amount = Number(e.amountUsd);
    let serviceId = null;
    if (e.appointmentId) serviceId = apptServiceMap[e.appointmentId] || null;
    else if (e.treatmentHistoryId) serviceId = thServiceMap[e.treatmentHistoryId] || null;

    if (serviceId) {
      if (!serviceAgg[serviceId]) serviceAgg[serviceId] = { serviceId, count: 0, totalUsd: 0 };
      serviceAgg[serviceId].count++;
      serviceAgg[serviceId].totalUsd += amount;
    } else {
      unattributed.count++;
      unattributed.totalUsd += amount;
    }
  }

  const serviceIds = Object.keys(serviceAgg);
  const serviceNames = {};
  if (serviceIds.length > 0) {
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds }, tenantId },
      select: { id: true, name: true, category: true },
    });
    for (const s of services) serviceNames[s.id] = { name: s.name, category: s.category };
  }

  const byService = Object.values(serviceAgg)
    .map((s) => ({
      serviceId: s.serviceId,
      serviceName: serviceNames[s.serviceId]?.name ?? null,
      category: serviceNames[s.serviceId]?.category ?? null,
      count: s.count,
      totalUsd: (Math.round(s.totalUsd * 100) / 100).toFixed(2),
    }))
    .sort((a, b) => Number(b.totalUsd) - Number(a.totalUsd));

  let planTotal = 0;
  for (const e of planEntries) planTotal += Number(e.amountUsd);

  const grandTotal = entries.reduce((acc, e) => acc + Number(e.amountUsd), 0);

  return {
    byService,
    unattributed: {
      count: unattributed.count,
      totalUsd: (Math.round(unattributed.totalUsd * 100) / 100).toFixed(2),
    },
    planRevenue: {
      count: planEntries.length,
      totalUsd: (Math.round(planTotal * 100) / 100).toFixed(2),
    },
    grandTotalUsd: (Math.round(grandTotal * 100) / 100).toFixed(2),
  };
}

async function serviciosVendidos(tenantId, from, to) {
  const appointments = await prisma.appointment.findMany({
    where: {
      tenantId,
      status: { in: ['pendiente', 'confirmado'] },
      startsAt: { gte: from, lt: to },
    },
    select: { serviceId: true },
  });

  const agg = {};
  for (const a of appointments) {
    if (!agg[a.serviceId]) agg[a.serviceId] = { serviceId: a.serviceId, count: 0 };
    agg[a.serviceId].count++;
  }

  const serviceIds = Object.keys(agg);
  const serviceNames = {};
  if (serviceIds.length > 0) {
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds }, tenantId },
      select: { id: true, name: true, category: true },
    });
    for (const s of services) serviceNames[s.id] = { name: s.name, category: s.category };
  }

  const ranked = Object.values(agg)
    .map((s) => ({
      serviceId: s.serviceId,
      serviceName: serviceNames[s.serviceId]?.name ?? null,
      category: serviceNames[s.serviceId]?.category ?? null,
      count: s.count,
    }))
    .sort((a, b) => b.count - a.count);

  return { services: ranked };
}

async function desempenoTerapeutas(tenantId, from, to, actor) {
  const canSeeFinancials = ['superadmin', 'dueno'].includes(actor.role);

  const staff = await prisma.user.findMany({
    where: { tenantId, canAttendAppointments: true, active: true },
    select: { id: true, name: true },
  });

  const appointments = await prisma.appointment.findMany({
    where: { tenantId, startsAt: { gte: from, lt: to } },
    select: { id: true, staffId: true, status: true, startsAt: true, endsAt: true },
  });

  const byStaff = {};
  for (const u of staff) {
    byStaff[u.id] = {
      staffId: u.id,
      staffName: u.name,
      citasAtendidas: 0,
      cancelaciones: 0,
      noShow: 0,
      horasAtendidas: 0,
    };
  }

  const confirmedApptIds = [];
  for (const a of appointments) {
    if (!byStaff[a.staffId]) continue;
    if (a.status === 'confirmado') {
      byStaff[a.staffId].citasAtendidas++;
      byStaff[a.staffId].horasAtendidas += (a.endsAt.getTime() - a.startsAt.getTime()) / 3600000;
      confirmedApptIds.push(a.id);
    } else if (a.status === 'cancelado') {
      byStaff[a.staffId].cancelaciones++;
    } else if (a.status === 'no_show') {
      byStaff[a.staffId].noShow++;
    }
  }

  if (canSeeFinancials && confirmedApptIds.length > 0) {
    const ledger = await prisma.clientLedgerEntry.findMany({
      where: {
        tenantId,
        type: 'cargo',
        reversalOfId: null,
        clientPlanId: null,
        appointmentId: { in: confirmedApptIds },
      },
      select: { appointmentId: true, amountUsd: true },
    });

    const revenueByAppt = {};
    for (const e of ledger) {
      if (!e.appointmentId) continue;
      revenueByAppt[e.appointmentId] = (revenueByAppt[e.appointmentId] || 0) + Number(e.amountUsd);
    }

    const apptStaffMap = {};
    for (const a of appointments) {
      if (a.status === 'confirmado') apptStaffMap[a.id] = a.staffId;
    }

    for (const [apptId, amount] of Object.entries(revenueByAppt)) {
      const sid = apptStaffMap[apptId];
      if (sid && byStaff[sid]) {
        byStaff[sid].ingresosUsd = (byStaff[sid].ingresosUsd || 0) + amount;
      }
    }
  }

  const result = Object.values(byStaff).map((s) => {
    const out = {
      ...s,
      horasAtendidas: Math.round(s.horasAtendidas * 100) / 100,
    };
    if (canSeeFinancials) {
      out.ingresosUsd = (Math.round((s.ingresosUsd || 0) * 100) / 100).toFixed(2);
    }
    return out;
  });

  return { terapeutas: result };
}

async function cancelaciones(tenantId, from, to) {
  const appointments = await prisma.appointment.findMany({
    where: { tenantId, startsAt: { gte: from, lt: to } },
    select: { serviceId: true, status: true },
  });

  const totalCitas = appointments.length;
  const canceled = appointments.filter((a) => a.status === 'cancelado');
  const noShow = appointments.filter((a) => a.status === 'no_show');

  function byServiceBreakdown(list) {
    const agg = {};
    for (const a of list) {
      if (!agg[a.serviceId]) agg[a.serviceId] = { serviceId: a.serviceId, count: 0 };
      agg[a.serviceId].count++;
    }
    return Object.values(agg);
  }

  async function enrichWithNames(breakdown) {
    const ids = breakdown.map((b) => b.serviceId);
    if (ids.length === 0) return breakdown;
    const services = await prisma.service.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, name: true },
    });
    const nameMap = {};
    for (const s of services) nameMap[s.id] = s.name;
    return breakdown.map((b) => ({ ...b, serviceName: nameMap[b.serviceId] ?? null }));
  }

  const cancelByService = await enrichWithNames(byServiceBreakdown(canceled));
  const noShowByService = await enrichWithNames(byServiceBreakdown(noShow));

  return {
    totalCitas,
    cancelaciones: {
      count: canceled.length,
      rate: totalCitas > 0 ? Math.round((canceled.length / totalCitas) * 10000) / 100 : 0,
      byService: cancelByService,
    },
    noShow: {
      count: noShow.length,
      rate: totalCitas > 0 ? Math.round((noShow.length / totalCitas) * 10000) / 100 : 0,
      byService: noShowByService,
    },
  };
}

async function clientesNuevosRecurrentes(tenantId, from, to) {
  const nuevos = await prisma.client.findMany({
    where: { tenantId, createdAt: { gte: from, lt: to } },
    select: { id: true },
  });
  const nuevosIds = nuevos.map((c) => c.id);
  const nuevosSet = new Set(nuevosIds);

  const activosAppts = await prisma.appointment.findMany({
    where: {
      tenantId,
      status: { in: ['pendiente', 'confirmado'] },
      startsAt: { gte: from, lt: to },
    },
    select: { clientId: true },
  });
  const activosSet = new Set(activosAppts.map((a) => a.clientId));
  const activos = activosSet.size;

  let recurrentes = 0;
  let nuevosConCita = 0;
  for (const cid of activosSet) {
    if (nuevosSet.has(cid)) nuevosConCita++;
    else recurrentes++;
  }

  return {
    nuevos: nuevos.length,
    recurrentes,
    activos,
    nuevosIds,
    details: {
      nuevosConCita,
      nuevosSinCita: nuevos.length - nuevosConCita,
    },
  };
}

module.exports = { getReport, VALID_METRICS, countWorkDaysInRange, parseHoursRange };
