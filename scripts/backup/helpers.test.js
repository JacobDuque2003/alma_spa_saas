const test = require('node:test');
const assert = require('node:assert/strict');

const { todayInGuayaquil, backupFilename, scrubConnectionStrings, TZ } = require('./helpers');

test('todayInGuayaquil devuelve formato YYYY-MM-DD', () => {
  const result = todayInGuayaquil();
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/, 'debe ser YYYY-MM-DD');
});

test('todayInGuayaquil usa la TZ de Guayaquil (no UTC)', () => {
  // Un momento donde Guayaquil (UTC-5) y UTC caen en dias distintos:
  // 2026-09-05T02:00:00Z = 2026-09-04 21:00 en Guayaquil.
  const nightUtc = new Date('2026-09-05T02:00:00Z');
  const guayaquil = todayInGuayaquil(nightUtc);
  assert.equal(guayaquil, '2026-09-04', 'debe reflejar el dia local en Guayaquil, no UTC');
});

test('backupFilename tiene el patron alma-spa-YYYY-MM-DD.dump', () => {
  const name = backupFilename(new Date('2026-09-05T12:00:00Z'));
  assert.equal(name, 'alma-spa-2026-09-05.dump');
});

test('scrubConnectionStrings redacta URIs de postgres en errores', () => {
  const dirty = 'pg_dump: error: connection to server at "host" port 5432 failed: FATAL:  password authentication failed for user "app" (connection string: postgres://app:s3cret@host:5432/dbname)';
  const clean = scrubConnectionStrings(dirty);
  assert.ok(!clean.includes('s3cret'), 'la password no debe aparecer');
  assert.ok(!clean.includes('app:s3cret'), 'el par user:pass no debe aparecer');
  assert.ok(clean.includes('[REDACTED]'));
});

test('scrubConnectionStrings tambien redacta postgresql:// (con l)', () => {
  const dirty = 'ERROR at postgresql://u:p@h:5432/d and more text';
  const clean = scrubConnectionStrings(dirty);
  assert.ok(!clean.includes('u:p'));
  assert.ok(clean.includes('[REDACTED]'));
});

test('scrubConnectionStrings maneja null/undefined sin lanzar', () => {
  assert.equal(scrubConnectionStrings(null), '');
  assert.equal(scrubConnectionStrings(undefined), '');
});

test('TZ es America/Guayaquil', () => {
  assert.equal(TZ, 'America/Guayaquil');
});

// Guard: verify parseServiceAccountKey rejects malformed input without
// echoing the raw contents in the error.
test('parseServiceAccountKey rechaza JSON invalido sin filtrar contenido', () => {
  const { parseServiceAccountKey } = require('./gcsUploader');
  const secretLooking = '{"private_key":"-----BEGIN PRIVATE KEY-----SECRETSTUFF-----END PRIVATE KEY-----"';  // truncated JSON
  try {
    parseServiceAccountKey(secretLooking);
    assert.fail('debio lanzar');
  } catch (err) {
    assert.ok(!err.message.includes('SECRETSTUFF'), 'el mensaje de error NO debe incluir contenido de la llave');
    assert.match(err.message, /GCS_SERVICE_ACCOUNT_KEY invalida/);
  }
});

test('parseServiceAccountKey rechaza JSON valido pero sin campos requeridos', () => {
  const { parseServiceAccountKey } = require('./gcsUploader');
  assert.throws(
    () => parseServiceAccountKey('{"foo":"bar"}'),
    /faltan campos requeridos/
  );
});

test('parseServiceAccountKey acepta JSON valido con campos requeridos', () => {
  const { parseServiceAccountKey } = require('./gcsUploader');
  const valid = JSON.stringify({
    type: 'service_account',
    project_id: 'test-project',
    client_email: 'sa@test.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
  });
  const parsed = parseServiceAccountKey(valid);
  assert.equal(parsed.project_id, 'test-project');
});

test('resolvePgDumpBinary usa PG_DUMP_PATH cuando esta seteada', () => {
  const { resolvePgDumpBinary } = require('./run');
  const prev = process.env.PG_DUMP_PATH;
  try {
    process.env.PG_DUMP_PATH = '/usr/bin/pg_dump';
    assert.equal(resolvePgDumpBinary(), '/usr/bin/pg_dump');
  } finally {
    if (prev === undefined) delete process.env.PG_DUMP_PATH;
    else process.env.PG_DUMP_PATH = prev;
  }
});

test('resolvePgDumpBinary hace fallback a "pg_dump" cuando PG_DUMP_PATH no esta', () => {
  const { resolvePgDumpBinary } = require('./run');
  const prev = process.env.PG_DUMP_PATH;
  try {
    delete process.env.PG_DUMP_PATH;
    assert.equal(resolvePgDumpBinary(), 'pg_dump');
  } finally {
    if (prev !== undefined) process.env.PG_DUMP_PATH = prev;
  }
});

test('resolvePgDumpBinary ignora valores vacios o de solo espacios', () => {
  const { resolvePgDumpBinary } = require('./run');
  const prev = process.env.PG_DUMP_PATH;
  try {
    process.env.PG_DUMP_PATH = '   ';
    assert.equal(resolvePgDumpBinary(), 'pg_dump');
    process.env.PG_DUMP_PATH = '';
    assert.equal(resolvePgDumpBinary(), 'pg_dump');
  } finally {
    if (prev === undefined) delete process.env.PG_DUMP_PATH;
    else process.env.PG_DUMP_PATH = prev;
  }
});

test('compareCounts: todos los conteos coinciden -> allMatch=true', () => {
  const { compareCounts } = require('./restore-test');
  const expected = { Tenant: 1, User: 8, Client: 7 };
  const actual = { Tenant: { count: 1 }, User: { count: 8 }, Client: { count: 7 } };
  const result = compareCounts(expected, actual);
  assert.equal(result.allMatch, true);
  assert.equal(result.rows.length, 3);
  assert.ok(result.rows.every((r) => r.match));
});

test('compareCounts: un conteo distinto -> allMatch=false y esa fila con match=false', () => {
  const { compareCounts } = require('./restore-test');
  const expected = { Tenant: 1, User: 8 };
  const actual = { Tenant: { count: 1 }, User: { count: 7 } };
  const result = compareCounts(expected, actual);
  assert.equal(result.allMatch, false);
  const userRow = result.rows.find((r) => r.table === 'User');
  assert.equal(userRow.match, false);
  assert.equal(userRow.actual, 7);
  assert.equal(userRow.expected, 8);
});

test('compareCounts: error al contar una tabla -> allMatch=false con error registrado', () => {
  const { compareCounts } = require('./restore-test');
  const expected = { Tenant: 1, User: 8 };
  const actual = { Tenant: { count: 1 }, User: { error: 'relation "User" does not exist' } };
  const result = compareCounts(expected, actual);
  assert.equal(result.allMatch, false);
  const userRow = result.rows.find((r) => r.table === 'User');
  assert.equal(userRow.match, false);
  assert.equal(userRow.actual, null);
  assert.match(userRow.error, /does not exist/);
});

test('EXPECTED_COUNTS baseline 2026-09-06: 8 tablas clave con los conteos del inventario', () => {
  const { EXPECTED_COUNTS } = require('./restore-test');
  assert.equal(EXPECTED_COUNTS.Tenant, 1);
  assert.equal(EXPECTED_COUNTS.User, 8);
  assert.equal(EXPECTED_COUNTS.Client, 7);
  assert.equal(EXPECTED_COUNTS.Appointment, 43);
  assert.equal(EXPECTED_COUNTS.Service, 20);
  assert.equal(EXPECTED_COUNTS.Room, 11);
  assert.equal(EXPECTED_COUNTS.ServiceCategory, 13);
  assert.equal(EXPECTED_COUNTS.WhatsAppMessage, 763);
});
