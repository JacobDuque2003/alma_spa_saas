const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const supertest = require('supertest');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'a]G4k!mR#9sXw2Lp@vN7jQ6dY1bT0cFe';
process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const { signToken } = require('../utils/jwt');
const app = require('../app');

test('GET /auth/me devuelve permisos efectivos para personal y nunca passwordHash', async () => {
  prisma.user = {
    findUnique: async (args) => {
      if (args.select.sessionVersion) {
        return {
          id: 'u-personal', name: 'Daniela Mora', email: 'daniela@alma.test',
          role: 'personal', tenantId: 't1', active: true, sessionVersion: 0,
        };
      }
      assert.equal(args.select.passwordHash, undefined);
      assert.equal(args.select.rolePermission, true);
      return {
        id: 'u-personal',
        name: 'Daniela Mora',
        email: 'daniela@alma.test',
        role: 'personal',
        tenantId: 't1',
        passwordHash: 'hash-que-no-debe-salir',
        rolePermission: {
          agenda: true,
          gabinetes: true,
          clientes: true,
          clientesEditar: false,
          clientesAnamnesis: true,
          clientesHistorial: false,
          clientesEstado: false,
          clientesEliminar: false,
          clientesExportar: false,
          crmEtiquetasGestionar: false,
          crmRespuestasRapidasGestionar: false,
          crmNotasGestionar: false,
          crm: false,
          reportes: false,
          configuracion: false,
          configuracionServicios: false,
          configuracionHorario: false,
        },
      };
    },
  };

  const token = signToken({ id: 'u-personal', tenantId: 't1', role: 'personal' });
  const res = await supertest(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.email, 'daniela@alma.test');
  assert.deepEqual(res.body.permissions, {
    agenda: true,
    gabinetes: true,
    clientes: true,
    clientesEditar: false,
    clientesAnamnesis: true,
    clientesHistorial: false,
    clientesEstado: false,
    clientesEliminar: false,
    clientesExportar: false,
    crmEtiquetasGestionar: false,
    crmRespuestasRapidasGestionar: false,
    crmNotasGestionar: false,
    crm: false,
    reportes: false,
    configuracion: false,
    configuracionServicios: false,
    configuracionHorario: false,
  });
  assert.equal('passwordHash' in res.body, false);
  assert.equal('rolePermission' in res.body, false);
});

test('GET /auth/me devuelve todos los permisos efectivos para dueno', async () => {
  prisma.user = {
    findUnique: async (args) => args.select.sessionVersion
      ? {
          id: 'u-dueno', name: 'Mariana Rios', email: 'mariana@alma.test',
          role: 'dueno', tenantId: 't1', active: true, sessionVersion: 0,
        }
      : {
          id: 'u-dueno', name: 'Mariana Rios', email: 'mariana@alma.test',
          role: 'dueno', tenantId: 't1', rolePermission: null,
        },
  };

  const token = signToken({ id: 'u-dueno', tenantId: 't1', role: 'dueno' });
  const res = await supertest(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.permissions, {
    agenda: true,
    gabinetes: true,
    clientes: true,
    clientesEditar: true,
    clientesAnamnesis: true,
    clientesHistorial: true,
    clientesEstado: true,
    clientesEliminar: true,
    clientesExportar: true,
    crmEtiquetasGestionar: true,
    crmRespuestasRapidasGestionar: true,
    crmNotasGestionar: true,
    crm: true,
    reportes: true,
    configuracion: true,
    configuracionServicios: true,
    configuracionHorario: true,
  });
});
