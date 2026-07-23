require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const serviceRoutes = require('./routes/services');
const roomRoutes = require('./routes/rooms');
const categoryRoutes = require('./routes/categories');
const planRoutes = require('./routes/plans');
const publicBookingRoutes = require('./routes/public/booking');
const publicBookingConfirmationRoutes = require('./routes/public/bookingConfirmation');
const appointmentRoutes = require('./routes/appointments');
const clientRoutes = require('./routes/clients');
const whatsappSettingsRoutes = require('./routes/settings/whatsapp');
const whatsappWebhookRoutes = require('./routes/webhooks/whatsapp');
const crmRoutes = require('./routes/crm');
const reportRoutes = require('./routes/reports');
const tenantConfigRoutes = require('./routes/tenantConfig');
const auditLogRoutes = require('./routes/auditLog');
const errorHandler = require('./middleware/errorHandler');
const { assertEncryptionKeyOrExit } = require('./utils/intakeCrypto');
const { assertWhatsappKeyOrExit } = require('./utils/whatsappCredentialCrypto');
const { assertJwtSecretOrExit } = require('./utils/jwt');

const app = express();

// B3: Railway usa un solo reverse proxy (edge router) que termina TLS y añade
// la IP real al final de X-Forwarded-For. Con 1, Express toma la última
// entrada, ignorando IPs falsas inyectadas por un atacante.
app.set('trust proxy', 1);

// B1: headers de seguridad para API pura (sin HTML server-rendered).
app.use(helmet({
  xContentTypeOptions: true,
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
  xFrameOptions: { action: 'deny' },
  xDnsPrefetchControl: { allow: false },
  xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
  xDownloadOptions: true,
  referrerPolicy: { policy: 'no-referrer' },
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false,
  xXssProtection: false,
}));

app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
  limit: '256kb',
}));

app.get('/health', async (req, res) => {
  try {
    await require('./utils/prisma').$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/services', serviceRoutes);
app.use('/rooms', roomRoutes);
app.use('/categories', categoryRoutes);
app.use('/plans', planRoutes);
app.use('/appointments', appointmentRoutes);
app.use('/', clientRoutes);
app.use('/public/bookings', publicBookingConfirmationRoutes);
app.use('/public/:tenantSlug', publicBookingRoutes);

app.use('/webhooks/whatsapp/:tenantSlug', whatsappWebhookRoutes);
app.use('/settings/whatsapp', whatsappSettingsRoutes);
app.use('/crm', crmRoutes);
app.use('/reports', reportRoutes);
app.use('/tenant/config', tenantConfigRoutes);
app.use('/audit-log', auditLogRoutes);

app.use(errorHandler);

function assertKeysDifferOrExit() {
  const a = process.env.INTAKE_ENCRYPTION_KEY;
  const b = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (a && b && a === b) {
    console.error('[FATAL] INTAKE_ENCRYPTION_KEY y WHATSAPP_TOKEN_ENCRYPTION_KEY no pueden ser iguales — compartimentación por radio de daño requiere claves distintas');
    process.exit(1);
  }
}

if (require.main === module) {
  assertJwtSecretOrExit();
  assertEncryptionKeyOrExit();
  assertWhatsappKeyOrExit();
  assertKeysDifferOrExit();

  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] unhandledRejection — el proceso seguirá pero esto debe corregirse:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException — cerrando proceso:', err);
    process.exit(1);
  });

  const prisma = require('./utils/prisma');

  function gracefulShutdown(signal) {
    console.log(`[${signal}] Cerrando servidor…`);
    server.close(() => {
      prisma.$disconnect().then(() => {
        console.log('[shutdown] Prisma desconectado, saliendo.');
        process.exit(0);
      });
    });
    setTimeout(() => {
      console.error('[shutdown] Timeout — forzando salida.');
      process.exit(1);
    }, 10_000);
  }

  const port = process.env.PORT || 3001;
  const server = app.listen(port, () => console.log(`Alma Spa backend escuchando en :${port}`));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = app;
