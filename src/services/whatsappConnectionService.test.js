const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const prisma = require('../utils/prisma');
const connectionService = require('./whatsappConnectionService');

test('getConnectionStatus: select físicamente omite las columnas *Enc/*Iv/*Tag y el hash', async () => {
  let capturedSelect = null;
  prisma.whatsAppConnection = {
    findUnique: async (args) => {
      capturedSelect = args.select;
      return {
        phoneNumberId: '111', wabaId: '222', displayPhone: '+593999',
        status: 'activo', lastError: null, lastVerifiedAt: new Date(), connectedAt: new Date(),
      };
    },
  };
  const status = await connectionService.getConnectionStatus({ tenantId: 't1', role: 'dueno' });
  assert.equal(status.connected, true);
  assert.equal('accessTokenEnc' in status, false);
  assert.equal('appSecretEnc' in status, false);
  assert.equal('verifyTokenHash' in status, false);
  // El select explícito NO incluye ninguna columna secreta:
  assert.equal(capturedSelect.accessTokenEnc, undefined);
  assert.equal(capturedSelect.appSecretEnc, undefined);
  assert.equal(capturedSelect.verifyTokenHash, undefined);
});

test('getConnectionStatus: sin conexión → { connected: false }', async () => {
  prisma.whatsAppConnection = { findUnique: async () => null };
  const status = await connectionService.getConnectionStatus({ tenantId: 't1', role: 'dueno' });
  assert.deepEqual(status, { connected: false });
});

test('replaceConnection: valida los 5 campos requeridos', async () => {
  prisma.whatsAppConnection = { findUnique: async () => null };
  await assert.rejects(
    () => connectionService.replaceConnection({ tenantId: 't1', role: 'dueno' }, { phoneNumberId: '111' }),
    (err) => err.status === 400
  );
});

test('replaceConnection: phoneNumberId ya tomado por otro tenant → 400 amable (no P2002 crudo)', async () => {
  prisma.whatsAppConnection = {
    findUnique: async () => ({ tenantId: 'otro-tenant', phoneNumberId: '111' }),
  };
  await assert.rejects(
    () => connectionService.replaceConnection(
      { tenantId: 't1', role: 'dueno' },
      { phoneNumberId: '111', wabaId: '222', accessToken: 'tok', appSecret: 'sec', verifyToken: 'v' }
    ),
    (err) => err.status === 400 && /ya está conectado/.test(err.message)
  );
});
