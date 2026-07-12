const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const { getReport, VALID_METRICS, countWorkDaysInRange, parseHoursRange } = require('./reportService');

const TENANT_ID = 't-report';
const DUENO = { id: 'u-dueno', tenantId: TENANT_ID, role: 'dueno' };
const PERSONAL = { id: 'u-personal', tenantId: TENANT_ID, role: 'personal' };

test('VALID_METRICS contiene las 6 métricas del plan', () => {
  assert.equal(VALID_METRICS.length, 6);
  assert.ok(VALID_METRICS.includes('ocupacion-gabinetes'));
  assert.ok(VALID_METRICS.includes('ingresos-servicio'));
  assert.ok(VALID_METRICS.includes('servicios-vendidos'));
  assert.ok(VALID_METRICS.includes('desempeno-terapeutas'));
  assert.ok(VALID_METRICS.includes('cancelaciones'));
  assert.ok(VALID_METRICS.includes('clientes-nuevos-recurrentes'));
});

test('countWorkDaysInRange: semana lun-sáb en julio 2026', () => {
  const from = new Date('2026-07-06T00:00:00Z'); // lunes
  const to = new Date('2026-07-13T00:00:00Z');   // lunes siguiente
  assert.equal(countWorkDaysInRange(from, to, [1, 2, 3, 4, 5, 6]), 6);
});

test('countWorkDaysInRange: solo lun-vie', () => {
  const from = new Date('2026-07-06T00:00:00Z');
  const to = new Date('2026-07-13T00:00:00Z');
  assert.equal(countWorkDaysInRange(from, to, [1, 2, 3, 4, 5]), 5);
});

test('parseHoursRange: 09:00-19:00 → 10h', () => {
  assert.equal(parseHoursRange({ start: '09:00', end: '19:00' }), 10);
});

test('parseHoursRange: 08:00-14:00 → 6h', () => {
  assert.equal(parseHoursRange({ start: '08:00', end: '14:00' }), 6);
});

test('ocupacion-gabinetes: gabinete con 2 citas de 1h en semana de 6 días × 10h', async () => {
  const from = new Date('2026-07-06T00:00:00Z');
  const to = new Date('2026-07-13T00:00:00Z');

  prisma.tenant = { findUnique: async () => ({ config: { workDays: [1, 2, 3, 4, 5, 6], businessHours: { start: '09:00', end: '19:00' } } }) };
  prisma.room = { findMany: async () => [{ id: 'r1', name: 'Gabinete 1', specialty: 'masajes' }] };
  prisma.appointment = {
    findMany: async () => [
      { roomId: 'r1', startsAt: new Date('2026-07-06T10:00:00Z'), endsAt: new Date('2026-07-06T11:00:00Z') },
      { roomId: 'r1', startsAt: new Date('2026-07-07T14:00:00Z'), endsAt: new Date('2026-07-07T15:00:00Z') },
    ],
  };

  const result = await getReport(TENANT_ID, 'ocupacion-gabinetes', from, to, DUENO);
  assert.equal(result.metric, 'ocupacion-gabinetes');
  assert.equal(result.data.gabinetes.length, 1);
  const g = result.data.gabinetes[0];
  assert.equal(g.horasOcupadas, 2);
  assert.equal(g.capacidadHoras, 60); // 10h × 6 días
  assert.equal(g.porcentaje, 3.33);   // 2/60 * 100
  assert.ok(result.comparison);
});

test('ingresos-servicio: separa por servicio, plan, y no atribuido', async () => {
  const from = new Date('2026-07-01T00:00:00Z');
  const to = new Date('2026-07-31T00:00:00Z');

  prisma.clientLedgerEntry = {
    findMany: async ({ where }) => {
      if (where.tenantId !== TENANT_ID) return [];
      return [
        { amountUsd: 50, appointmentId: 'a1', treatmentHistoryId: null, clientPlanId: null },
        { amountUsd: 30, appointmentId: 'a2', treatmentHistoryId: null, clientPlanId: null },
        { amountUsd: 80, appointmentId: null, treatmentHistoryId: null, clientPlanId: 'cp1' },
        { amountUsd: 20, appointmentId: null, treatmentHistoryId: null, clientPlanId: null },
      ];
    },
  };
  prisma.appointment = {
    findMany: async () => [
      { id: 'a1', serviceId: 's1' },
      { id: 'a2', serviceId: 's1' },
    ],
  };
  prisma.treatmentHistory = { findMany: async () => [] };
  prisma.service = {
    findMany: async () => [{ id: 's1', name: 'Masaje', category: 'masajes' }],
  };

  const result = await getReport(TENANT_ID, 'ingresos-servicio', from, to, DUENO);
  assert.equal(result.data.byService.length, 1);
  assert.equal(result.data.byService[0].serviceName, 'Masaje');
  assert.equal(result.data.byService[0].totalUsd, '80.00');
  assert.equal(result.data.byService[0].count, 2);
  assert.equal(result.data.planRevenue.totalUsd, '80.00');
  assert.equal(result.data.planRevenue.count, 1);
  assert.equal(result.data.unattributed.totalUsd, '20.00');
  assert.equal(result.data.grandTotalUsd, '180.00');
});

test('servicios-vendidos: ordena por count DESC', async () => {
  const from = new Date('2026-07-01T00:00:00Z');
  const to = new Date('2026-07-31T00:00:00Z');

  prisma.appointment = {
    findMany: async () => [
      { serviceId: 's1' },
      { serviceId: 's2' },
      { serviceId: 's2' },
      { serviceId: 's2' },
    ],
  };
  prisma.service = {
    findMany: async () => [
      { id: 's1', name: 'Facial', category: 'facial' },
      { id: 's2', name: 'Masaje', category: 'masajes' },
    ],
  };

  const result = await getReport(TENANT_ID, 'servicios-vendidos', from, to, DUENO);
  assert.equal(result.data.services.length, 2);
  assert.equal(result.data.services[0].serviceName, 'Masaje');
  assert.equal(result.data.services[0].count, 3);
  assert.equal(result.data.services[1].count, 1);
});

test('desempeno-terapeutas: dueño ve ingresosUsd, personal NO', async () => {
  const from = new Date('2026-07-01T00:00:00Z');
  const to = new Date('2026-07-31T00:00:00Z');

  prisma.user = {
    findMany: async () => [{ id: 'u1', name: 'Ana' }],
  };
  prisma.appointment = {
    findMany: async () => [
      { id: 'a1', staffId: 'u1', status: 'confirmado', startsAt: new Date('2026-07-10T10:00:00Z'), endsAt: new Date('2026-07-10T11:00:00Z') },
      { id: 'a2', staffId: 'u1', status: 'cancelado', startsAt: new Date('2026-07-11T10:00:00Z'), endsAt: new Date('2026-07-11T11:00:00Z') },
    ],
  };
  prisma.clientLedgerEntry = {
    findMany: async () => [{ appointmentId: 'a1', amountUsd: 100 }],
  };

  const duResult = await getReport(TENANT_ID, 'desempeno-terapeutas', from, to, DUENO);
  const t = duResult.data.terapeutas[0];
  assert.equal(t.citasAtendidas, 1);
  assert.equal(t.cancelaciones, 1);
  assert.equal(t.ingresosUsd, '100.00');

  const pResult = await getReport(TENANT_ID, 'desempeno-terapeutas', from, to, PERSONAL);
  const tp = pResult.data.terapeutas[0];
  assert.equal(tp.citasAtendidas, 1);
  assert.equal(tp.cancelaciones, 1);
  assert.equal(tp.ingresosUsd, undefined, 'personal NO debe ver ingresosUsd');
});

test('cancelaciones: rate correcto y desglose por servicio', async () => {
  const from = new Date('2026-07-01T00:00:00Z');
  const to = new Date('2026-07-31T00:00:00Z');

  prisma.appointment = {
    findMany: async () => [
      { serviceId: 's1', status: 'confirmado' },
      { serviceId: 's1', status: 'cancelado' },
      { serviceId: 's2', status: 'no_show' },
      { serviceId: 's2', status: 'pendiente' },
    ],
  };
  prisma.service = {
    findMany: async () => [
      { id: 's1', name: 'Facial' },
      { id: 's2', name: 'Masaje' },
    ],
  };

  const result = await getReport(TENANT_ID, 'cancelaciones', from, to, DUENO);
  assert.equal(result.data.totalCitas, 4);
  assert.equal(result.data.cancelaciones.count, 1);
  assert.equal(result.data.cancelaciones.rate, 25);
  assert.equal(result.data.noShow.count, 1);
  assert.equal(result.data.noShow.rate, 25);
});

test('clientes-nuevos-recurrentes: clasificación correcta', async () => {
  const from = new Date('2026-07-01T00:00:00Z');
  const to = new Date('2026-07-31T00:00:00Z');

  prisma.client = {
    findMany: async () => [
      { id: 'c-new1' },
      { id: 'c-new2' },
    ],
  };
  prisma.appointment = {
    findMany: async () => [
      { clientId: 'c-new1' },       // nuevo con cita
      { clientId: 'c-old1' },       // recurrente
      { clientId: 'c-old1' },       // misma recurrente (dedup por Set)
      { clientId: 'c-old2' },       // otra recurrente
    ],
  };

  const result = await getReport(TENANT_ID, 'clientes-nuevos-recurrentes', from, to, DUENO);
  assert.equal(result.data.nuevos, 2);
  assert.equal(result.data.activos, 3);    // c-new1, c-old1, c-old2
  assert.equal(result.data.recurrentes, 2); // c-old1, c-old2
  assert.equal(result.data.details.nuevosConCita, 1);
  assert.equal(result.data.details.nuevosSinCita, 1);
});

test('comparison: usa periodo anterior del mismo ancho', async () => {
  const from = new Date('2026-07-01T00:00:00Z');
  const to = new Date('2026-07-31T00:00:00Z');

  prisma.client = { findMany: async () => [] };
  prisma.appointment = { findMany: async () => [] };

  const result = await getReport(TENANT_ID, 'clientes-nuevos-recurrentes', from, to, DUENO);
  assert.ok(result.comparison, 'debe incluir comparison');
  assert.equal(result.comparison.nuevos, 0);
  assert.equal(result.comparison.activos, 0);
});

test('endpoint router: métrica inválida → 400', async () => {
  const request = require('supertest');
  const app = require('../app');

  prisma.user = {
    findUnique: async () => ({ id: 'u-dueno', tenantId: TENANT_ID, role: 'dueno', active: true }),
  };

  const jwt = require('../utils/jwt');
  const token = jwt.signToken({ sub: 'u-dueno', tenantId: TENANT_ID, role: 'dueno' });

  const res = await request(app)
    .get('/reports/metrica-falsa?from=2026-07-01&to=2026-07-31')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 400);
  assert.ok(res.body.error.includes('Métrica inválida'));
});

test('endpoint router: from > to → 400', async () => {
  const request = require('supertest');
  const app = require('../app');

  const jwt = require('../utils/jwt');
  const token = jwt.signToken({ sub: 'u-dueno', tenantId: TENANT_ID, role: 'dueno' });

  const res = await request(app)
    .get('/reports/cancelaciones?from=2026-08-01&to=2026-07-01')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 400);
});

test('endpoint router: ingresos-servicio con role personal → 403', async () => {
  const request = require('supertest');
  const app = require('../app');

  prisma.rolePermission = {
    findUnique: async () => ({ reportes: true }),
  };

  const jwt = require('../utils/jwt');
  const token = jwt.signToken({ sub: 'u-personal', tenantId: TENANT_ID, role: 'personal' });

  const res = await request(app)
    .get('/reports/ingresos-servicio?from=2026-07-01&to=2026-07-31')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
});

test('endpoint router: rango > 366 días → 400', async () => {
  const request = require('supertest');
  const app = require('../app');

  const jwt = require('../utils/jwt');
  const token = jwt.signToken({ sub: 'u-dueno', tenantId: TENANT_ID, role: 'dueno' });

  const res = await request(app)
    .get('/reports/cancelaciones?from=2024-01-01&to=2026-07-01')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 400);
  assert.ok(res.body.error.includes('366'));
});
