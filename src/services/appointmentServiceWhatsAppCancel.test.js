const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.INTAKE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
const prisma = require('../utils/prisma');
const agendaEvents = require('./crmEventBus');
const { cancelWhatsAppAppointment } = require('./appointmentService');

const request = { tenantId: 't1', customerWaId: '593999000001', appointmentId: 'a1' };

function setup(t, { client = { id: 'c1' }, appointment = { id: 'a1', tenantId: 't1', clientId: 'c1', startsAt: new Date(Date.now() + 86_400_000), status: 'confirmado' }, commitError = false } = {}) {
  const seen = { clientQuery: null, updateQuery: null, readQuery: null, events: [], committed: false };
  t.mock.method(agendaEvents, 'publish', (...args) => { assert.equal(seen.committed, true); seen.events.push(args); });
  const tx = {
    client: { findFirst: async (args) => { seen.clientQuery = args; return client; } },
    appointment: {
      updateMany: async ({ where, data }) => {
        seen.updateQuery = { where, data };
        const matches = appointment && appointment.id === where.id && appointment.tenantId === where.tenantId
          && appointment.clientId === where.clientId && appointment.startsAt > where.startsAt.gt
          && where.status.in.includes(appointment.status);
        if (matches) appointment.status = data.status;
        return { count: matches ? 1 : 0 };
      },
      findFirst: async (args) => {
        seen.readQuery = args;
        return Object.fromEntries(Object.keys(args.select).map((key) => [key, appointment[key]]));
      },
    },
  };
  prisma.$transaction = async (fn) => {
    const result = await fn(tx);
    if (commitError) throw new Error('synthetic commit failure');
    seen.committed = true;
    return result;
  };
  return seen;
}

test('cancelacion WA valida posesion tenant y devuelve solo referencia segura despues del commit', async (t) => {
  const seen = setup(t);
  const result = await cancelWhatsAppAppointment(request);
  assert.deepEqual(seen.clientQuery, { where: { tenantId: 't1', whatsapp: '+593999000001', active: true }, select: { id: true } });
  assert.equal(seen.updateQuery.where.tenantId, 't1');
  assert.equal(seen.updateQuery.where.clientId, 'c1');
  assert.equal(seen.updateQuery.where.id, 'a1');
  assert.ok(seen.updateQuery.where.startsAt.gt instanceof Date);
  assert.deepEqual(seen.updateQuery.where.status.in, ['pendiente', 'pendiente_bot', 'confirmado']);
  assert.deepEqual(seen.updateQuery.data, { status: 'cancelado' });
  assert.equal(result.status, 'cancelado');
  assert.deepEqual(Object.keys(result).sort(), ['id', 'startsAt', 'status', 'tenantId']);
  assert.equal(seen.events.length, 1);
  assert.equal(seen.events[0][0], 't1');
  assert.equal(seen.events[0][1], 'appointment.status.updated');
  assert.equal(seen.events[0][2].appointmentId, 'a1');
  assert.equal('confirmationToken' in seen.readQuery.select, false);
});

test('cancelacion WA normaliza remitente local e internacional', async (t) => {
  for (const customerWaId of ['+593999000001', '0999000001', '593999000001']) {
    const seen = setup(t);
    await cancelWhatsAppAppointment({ ...request, customerWaId });
    assert.equal(seen.clientQuery.where.whatsapp, '+593999000001');
  }
});

test('cancelacion WA rechaza cliente ausente sin actualizar ni avisar', async (t) => {
  const seen = setup(t, { client: null });
  await assert.rejects(() => cancelWhatsAppAppointment(request), (err) => err.status === 400);
  assert.equal(seen.updateQuery, null);
  assert.equal(seen.events.length, 0);
});

test('cancelacion WA rechaza otra persona, otro tenant, pasada, cerrada o seleccion desconocida', async (t) => {
  for (const override of [{ tenantId: 't2' }, { clientId: 'c2' }, { startsAt: new Date(0) }, { status: 'cancelado' }, { status: 'no_show' }, { id: 'a2' }]) {
    const seen = setup(t, { appointment: { id: 'a1', tenantId: 't1', clientId: 'c1', startsAt: new Date(Date.now() + 86_400_000), status: 'confirmado', ...override } });
    await assert.rejects(() => cancelWhatsAppAppointment(request), (err) => err.status === 400 && /No se pudo cancelar/.test(err.message));
    assert.equal(seen.readQuery, null);
    assert.equal(seen.events.length, 0);
  }
});

test('cancelacion WA repetida no cancela ni publica dos veces', async (t) => {
  const seen = setup(t);
  await cancelWhatsAppAppointment(request);
  await assert.rejects(() => cancelWhatsAppAppointment(request), (err) => err.status === 400);
  assert.equal(seen.events.length, 1);
});

test('cancelacion WA no publica si falla el commit', async (t) => {
  const seen = setup(t, { commitError: true });
  await assert.rejects(() => cancelWhatsAppAppointment(request), /synthetic commit failure/);
  assert.equal(seen.events.length, 0);
});

test('cancelacion WA rechaza parametros invalidos sin consultar clientes', async (t) => {
  const seen = setup(t);
  for (const invalid of [{ tenantId: '' }, { customerWaId: '' }, { customerWaId: 'invalid' }, { appointmentId: '' }, { appointmentId: ['a1'] }]) {
    await assert.rejects(() => cancelWhatsAppAppointment({ ...request, ...invalid }), (err) => err.status === 400);
  }
  assert.equal(seen.clientQuery, null);
  assert.equal(seen.events.length, 0);
});
