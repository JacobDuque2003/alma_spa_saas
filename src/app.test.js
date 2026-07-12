const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'a]G4k!mR#9sXw2Lp@vN7jQ6dY1bT0cFe';
process.env.INTAKE_ENCRYPTION_KEY = process.env.INTAKE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const { AppError, BadRequestError, SlotUnavailableError } = require('./utils/errors');
const { ForbiddenTenantError } = require('./utils/tenantScope');
const errorHandler = require('./middleware/errorHandler');
const supertest = require('supertest');

// --- AppError hierarchy ---

test('BadRequestError instanceof AppError', () => {
  const err = new BadRequestError('campo requerido');
  assert.ok(err instanceof AppError);
  assert.equal(err.status, 400);
  assert.equal(err.message, 'campo requerido');
});

test('SlotUnavailableError instanceof AppError', () => {
  const err = new SlotUnavailableError();
  assert.ok(err instanceof AppError);
  assert.equal(err.status, 409);
});

test('ForbiddenTenantError instanceof AppError', () => {
  const err = new ForbiddenTenantError();
  assert.ok(err instanceof AppError);
  assert.equal(err.status, 403);
});

test('ProtectedAccountError instanceof AppError', () => {
  const { ProtectedAccountError } = require('./services/userService');
  const err = new ProtectedAccountError();
  assert.ok(err instanceof AppError);
  assert.equal(err.status, 403);
});

// --- Error handler (uses real errorHandler module) ---

function buildTestApp(throwFn) {
  const express = require('express');
  const helmet = require('helmet');
  const app = express();
  app.set('trust proxy', 1);
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
  app.use(express.json({ limit: '1kb' }));
  app.get('/test-error', (req, res, next) => {
    try { throwFn(); res.json({ ok: true }); } catch (e) { next(e); }
  });
  app.post('/test-body', (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

// Business errors pass through with original message

test('error handler: BadRequestError preserves business message', async () => {
  const app = buildTestApp(() => { throw new BadRequestError('Este servicio no ofrece modalidad a domicilio'); });
  const res = await supertest(app).get('/test-error');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Este servicio no ofrece modalidad a domicilio');
});

test('error handler: SlotUnavailableError preserves business message', async () => {
  const app = buildTestApp(() => { throw new SlotUnavailableError(); });
  const res = await supertest(app).get('/test-error');
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'Este horario ya no está disponible');
});

test('error handler: ForbiddenTenantError preserves business message', async () => {
  const app = buildTestApp(() => { throw new ForbiddenTenantError(); });
  const res = await supertest(app).get('/test-error');
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'No tiene acceso a este recurso');
});

test('error handler: BadRequestError with overridden status (WINDOW_CLOSED) preserves message', async () => {
  const app = buildTestApp(() => {
    const err = new BadRequestError('WINDOW_CLOSED: pasaron más de 24h');
    err.status = 422;
    throw err;
  });
  const res = await supertest(app).get('/test-error');
  assert.equal(res.status, 422);
  assert.equal(res.body.error, 'WINDOW_CLOSED: pasaron más de 24h');
});

// Non-AppError errors are sanitized

test('error handler: Prisma P2002 returns generic 409, not table/constraint names', async () => {
  const app = buildTestApp(() => {
    const err = new Error('Unique constraint failed on the fields: (`email`)');
    err.code = 'P2002';
    throw err;
  });
  const res = await supertest(app).get('/test-error');
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'El registro ya existe');
});

test('error handler: Prisma P2025 returns generic 404', async () => {
  const app = buildTestApp(() => {
    const err = new Error('Record not found');
    err.code = 'P2025';
    throw err;
  });
  const res = await supertest(app).get('/test-error');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Registro no encontrado');
});

test('error handler: unknown library error with status 400 gets generic message', async () => {
  const app = buildTestApp(() => {
    const err = new Error('Something leaked from a library');
    err.status = 400;
    throw err;
  });
  const res = await supertest(app).get('/test-error');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Solicitud inválida');
  assert.ok(!res.body.error.includes('leaked'));
});

test('error handler: generic 5xx returns "Error interno"', async () => {
  const app = buildTestApp(() => { throw new Error('unhandled crash'); });
  const res = await supertest(app).get('/test-error');
  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'Error interno');
  assert.ok(!res.body.error.includes('crash'));
});

test('error handler: malformed JSON body returns safe message', async () => {
  const app = buildTestApp(() => {});
  const res = await supertest(app)
    .post('/test-body')
    .set('Content-Type', 'application/json')
    .send('{{invalid json');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Cuerpo JSON inválido');
});

test('error handler: payload too large returns 413', async () => {
  const app = buildTestApp(() => {});
  const res = await supertest(app)
    .post('/test-body')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ data: 'x'.repeat(2000) }));
  assert.equal(res.status, 413);
  assert.equal(res.body.error, 'Payload demasiado grande');
});

// --- B3: trust proxy ---

test('trust proxy: req.ip reflects X-Forwarded-For (1 hop)', async () => {
  const express = require('express');
  const app = express();
  app.set('trust proxy', 1);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const res = await supertest(app)
    .get('/ip')
    .set('X-Forwarded-For', '203.0.113.50');
  assert.equal(res.body.ip, '203.0.113.50');
});

test('trust proxy: spoofed multi-hop X-Forwarded-For uses rightmost', async () => {
  const express = require('express');
  const app = express();
  app.set('trust proxy', 1);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const res = await supertest(app)
    .get('/ip')
    .set('X-Forwarded-For', '1.2.3.4, 5.6.7.8, 203.0.113.50');
  assert.equal(res.body.ip, '203.0.113.50');
});

// --- B1: helmet headers ---

test('helmet: security headers present on API responses', async () => {
  const app = buildTestApp(() => { throw new BadRequestError('test'); });
  const res = await supertest(app).get('/test-error');
  assert.ok(res.headers['x-content-type-options']);
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.ok(res.headers['strict-transport-security']);
  assert.ok(!res.headers['x-powered-by']);
  assert.ok(!res.headers['content-security-policy']);
});

// --- B5: assertJwtSecretOrExit ---

test('assertJwtSecretOrExit: does not exit with valid 32+ byte secret', () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'a]G4k!mR#9sXw2Lp@vN7jQ6dY1bT0cFe';
  const { assertJwtSecretOrExit } = require('./utils/jwt');
  const origExit = process.exit;
  process.exit = () => { throw new Error('exit called'); };
  try {
    assertJwtSecretOrExit();
  } finally {
    process.exit = origExit;
    process.env.JWT_SECRET = original;
  }
});

test('assertJwtSecretOrExit: exits with short secret (< 32 bytes)', () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'tooshort';
  const { assertJwtSecretOrExit } = require('./utils/jwt');
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error('EXIT_MOCK'); };
  try {
    assertJwtSecretOrExit();
    assert.fail('should have called process.exit');
  } catch (e) {
    assert.equal(e.message, 'EXIT_MOCK');
    assert.equal(exitCode, 1);
  } finally {
    process.exit = origExit;
    process.env.JWT_SECRET = original;
  }
});

test('assertJwtSecretOrExit: exits when JWT_SECRET is undefined', () => {
  const original = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  const { assertJwtSecretOrExit } = require('./utils/jwt');
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error('EXIT_MOCK'); };
  try {
    assertJwtSecretOrExit();
    assert.fail('should have called process.exit');
  } catch (e) {
    assert.equal(e.message, 'EXIT_MOCK');
    assert.equal(exitCode, 1);
  } finally {
    process.exit = origExit;
    process.env.JWT_SECRET = original;
  }
});
