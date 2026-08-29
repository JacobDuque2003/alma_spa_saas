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
const searchRoutes = require('./routes/search');
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

// Límite más generoso solo para /services: la descripción+imagen de un
// servicio viaja como data URL base64 (~400KB para una imagen de 300KB
// cruda). Montado ANTES del parser global — body-parser marca el body como
// ya parseado, así que el límite de 256kb de abajo no vuelve a aplicar aquí,
// y el resto de la API queda intacto con el límite estricto.
app.use('/services', express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
  limit: '1mb',
}));

// Adjuntos de la bandeja CRM: se envían como data URL base64 desde el frontend
// y luego el backend los sube a Meta. El límite queda acotado a CRM para no
// aflojar el resto de la API.
app.use('/crm', express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
  limit: '12mb',
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

const BOOT_TIME = new Date().toISOString();
app.get('/version', (_req, res) => {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA;
  res.json({
    commit: sha ? sha.slice(0, 7) : 'desconocido',
    deployedAt: BOOT_TIME,
    nodeEnv: process.env.NODE_ENV || 'development',
  });
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
app.use('/search', searchRoutes);

app.use(errorHandler);

function assertKeysDifferOrExit() {
  const a = process.env.INTAKE_ENCRYPTION_KEY;
  const b = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (a && b && a === b) {
    console.error('[FATAL] INTAKE_ENCRYPTION_KEY y WHATSAPP_TOKEN_ENCRYPTION_KEY no pueden ser iguales — compartimentación por radio de daño requiere claves distintas');
    process.exit(1);
  }
}

function warnMissingWhatsappEnv() {
  const required = ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(`[WARN] Variables de WhatsApp no configuradas: ${missing.join(', ')}. El bot y webhook no funcionarán.`);
  }
}

if (require.main === module) {
  assertJwtSecretOrExit();
  assertEncryptionKeyOrExit();
  if (process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY) {
    assertWhatsappKeyOrExit();
    assertKeysDifferOrExit();
  }
  warnMissingWhatsappEnv();

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
