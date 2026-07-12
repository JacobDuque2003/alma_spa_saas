require('dotenv').config();
const express = require('express');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const serviceRoutes = require('./routes/services');
const roomRoutes = require('./routes/rooms');
const planRoutes = require('./routes/plans');
const publicBookingRoutes = require('./routes/public/booking');
const publicBookingConfirmationRoutes = require('./routes/public/bookingConfirmation');
const appointmentRoutes = require('./routes/appointments');
const clientRoutes = require('./routes/clients');
const whatsappSettingsRoutes = require('./routes/settings/whatsapp');
const whatsappWebhookRoutes = require('./routes/webhooks/whatsapp');
const crmRoutes = require('./routes/crm');
const reportRoutes = require('./routes/reports');
const { assertEncryptionKeyOrExit } = require('./utils/intakeCrypto');
const { assertWhatsappKeyOrExit } = require('./utils/whatsappCredentialCrypto');

const app = express();
// verify: captura los bytes crudos del body en req.rawBody para poder verificar
// la firma HMAC del webhook de WhatsApp (§3). Reserializar JSON.stringify(body)
// no reproduce los bytes originales, así que rawBody es obligatorio y no hay
// fallback. limit: 256kb protege contra amplificación de DoS en un endpoint público.
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
  limit: '256kb',
}));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/services', serviceRoutes);
app.use('/rooms', roomRoutes);
app.use('/plans', planRoutes);
app.use('/appointments', appointmentRoutes);
// Fase 4: rutas de clientes (intake, tratamientos, planes, saldo). El router
// define rutas completas (/clients/..., /treatments/..., /client-plans/...,
// /ledger/...), por eso se monta en la raíz.
app.use('/', clientRoutes);
// Orden importa: la ruta literal /public/bookings debe montarse ANTES que
// /public/:tenantSlug, o Express la interpretaría como tenantSlug="bookings".
app.use('/public/bookings', publicBookingConfirmationRoutes);
app.use('/public/:tenantSlug', publicBookingRoutes);

// Fase 5 — CRM (WhatsApp)
// Webhook: sin authenticate (lo llama Meta), su seguridad es la firma HMAC.
app.use('/webhooks/whatsapp/:tenantSlug', whatsappWebhookRoutes);
app.use('/settings/whatsapp', whatsappSettingsRoutes);
app.use('/crm', crmRoutes);
app.use('/reports', reportRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
    return res.status(status).json({ error: 'Error interno' });
  }
  res.status(status).json({ error: err.message });
});

function assertKeysDifferOrExit() {
  const a = process.env.INTAKE_ENCRYPTION_KEY;
  const b = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (a && b && a === b) {
    console.error('[FATAL] INTAKE_ENCRYPTION_KEY y WHATSAPP_TOKEN_ENCRYPTION_KEY no pueden ser iguales — compartimentación por radio de daño requiere claves distintas');
    process.exit(1);
  }
}

if (require.main === module) {
  assertEncryptionKeyOrExit();
  assertWhatsappKeyOrExit();
  assertKeysDifferOrExit();
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`Alma Spa backend escuchando en :${port}`));
}

module.exports = app;
