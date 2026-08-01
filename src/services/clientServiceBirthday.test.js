const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../utils/prisma');
const clientService = require('./clientService');
const { computeDaysUntilBirthday } = clientService;

const actor = { role: 'dueno', tenantId: 't1' };

test('createClient acepta birthday YYYY-MM-DD y lo persiste en UTC', async () => {
  let dataSeen = null;
  prisma.client = {
    create: async (args) => {
      dataSeen = args.data;
      return { ...args.data, id: 'c1', active: true, createdAt: new Date(), updatedAt: new Date() };
    },
  };

  const dto = await clientService.createClient(actor, {
    fullName: 'Camila', whatsapp: '+593999000001', email: null, birthday: '1997-03-15',
  });

  assert.equal(dataSeen.birthday.getUTCFullYear(), 1997);
  assert.equal(dataSeen.birthday.getUTCMonth(), 2);
  assert.equal(dataSeen.birthday.getUTCDate(), 15);
  assert.equal(dto.birthday, '1997-03-15');
});

test('createClient sin birthday guarda null y el DTO devuelve null', async () => {
  prisma.client = { create: async (args) => ({ ...args.data, id: 'c2', active: true, createdAt: new Date(), updatedAt: new Date() }) };
  const dto = await clientService.createClient(actor, { fullName: 'Sin bday', whatsapp: '+593999000002' });
  assert.equal(dto.birthday, null);
});

test('createClient rechaza formato inválido', async () => {
  prisma.client = { create: async () => { throw new Error('no debería llegar'); } };
  await assert.rejects(
    () => clientService.createClient(actor, { fullName: 'x', whatsapp: '+593999000003', birthday: '15/03/1997' }),
    (err) => err.status === 400 && /YYYY-MM-DD/.test(err.message),
  );
});

test('createClient rechaza fecha inexistente como 2026-02-30', async () => {
  prisma.client = { create: async () => { throw new Error('no debería llegar'); } };
  await assert.rejects(
    () => clientService.createClient(actor, { fullName: 'x', whatsapp: '+593999000004', birthday: '2026-02-30' }),
    (err) => err.status === 400,
  );
});

test('updateClient con birthday=null limpia el campo', async () => {
  let updateSeen = null;
  prisma.client = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1' }),
    update: async (args) => {
      updateSeen = args.data;
      return { id: 'c1', tenantId: 't1', fullName: 'x', whatsapp: '+593', email: null, birthday: null, active: true, createdAt: new Date(), updatedAt: new Date() };
    },
  };
  await clientService.updateClient(actor, 'c1', { birthday: null });
  assert.equal(updateSeen.birthday, null);
});

test('updateClient sin campo birthday NO toca birthday', async () => {
  let updateSeen = null;
  prisma.client = {
    findUnique: async () => ({ id: 'c1', tenantId: 't1' }),
    update: async (args) => {
      updateSeen = args.data;
      return { id: 'c1', tenantId: 't1', fullName: 'x', whatsapp: '+593999000005', email: null, birthday: null, active: true, createdAt: new Date(), updatedAt: new Date() };
    },
  };
  await clientService.updateClient(actor, 'c1', { fullName: 'Cambio nombre' });
  assert.equal('birthday' in updateSeen, false);
});

test('computeDaysUntilBirthday cruza el año: 31-dic → 1-ene = 1', () => {
  const today = new Date(Date.UTC(2026, 11, 31)); // 31 diciembre
  const bday = new Date(Date.UTC(1990, 0, 1));    // 1 enero de cualquier año
  assert.equal(computeDaysUntilBirthday(bday, today), 1);
});

test('computeDaysUntilBirthday cumpleaños hoy = 0', () => {
  const today = new Date(Date.UTC(2026, 6, 31));
  const bday = new Date(Date.UTC(1990, 6, 31));
  assert.equal(computeDaysUntilBirthday(bday, today), 0);
});

test('computeDaysUntilBirthday cumpleaños ayer = 364 (o 365 en bisiesto)', () => {
  const today = new Date(Date.UTC(2026, 6, 31));
  const bday = new Date(Date.UTC(1990, 6, 30));
  const d = computeDaysUntilBirthday(bday, today);
  assert.ok(d === 364 || d === 365, `esperaba 364 o 365, dio ${d}`);
});

test('computeDaysUntilBirthday respeta 29-feb usando el ancla 2000 (bisiesto)', () => {
  const today = new Date(Date.UTC(2026, 1, 28));
  const bday = new Date(Date.UTC(1996, 1, 29));
  assert.equal(computeDaysUntilBirthday(bday, today), 1);
});

test('listUpcomingBirthdays ordena por proximidad y filtra por ventana', async () => {
  const today = new Date();
  const in3 = new Date(today); in3.setUTCDate(in3.getUTCDate() + 3);
  const in10 = new Date(today); in10.setUTCDate(in10.getUTCDate() + 10);
  const in100 = new Date(today); in100.setUTCDate(in100.getUTCDate() + 100);
  prisma.client = {
    findMany: async () => [
      { id: 'far', fullName: 'Far', whatsapp: '+1', birthday: in100 },
      { id: 'today', fullName: 'HoyMismo', whatsapp: '+2', birthday: new Date(Date.UTC(1990, today.getUTCMonth(), today.getUTCDate())) },
      { id: 'in3', fullName: 'EnTres', whatsapp: '+3', birthday: in3 },
      { id: 'in10', fullName: 'EnDiez', whatsapp: '+4', birthday: in10 },
    ],
  };
  const res = await clientService.listUpcomingBirthdays(actor, 7);
  assert.equal(res.length, 2);
  assert.equal(res[0].id, 'today');
  assert.equal(res[0].daysUntil, 0);
  assert.equal(res[1].id, 'in3');
  assert.equal(res[1].daysUntil, 3);
});

test('listUpcomingBirthdays exige tenantId', async () => {
  prisma.client = { findMany: async () => [] };
  await assert.rejects(
    () => clientService.listUpcomingBirthdays({ role: 'superadmin' }),
    (err) => err.status === 400,
  );
});
