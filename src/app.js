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
const { assertEncryptionKeyOrExit } = require('./utils/intakeCrypto');

const app = express();
app.use(express.json());

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

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
    return res.status(status).json({ error: 'Error interno' });
  }
  res.status(status).json({ error: err.message });
});

if (require.main === module) {
  assertEncryptionKeyOrExit();
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`Alma Spa backend escuchando en :${port}`));
}

module.exports = app;
