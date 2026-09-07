// Ephemeral restore-verification. Runs inside the restore-test container
// (Dockerfile.restore-test at repo root). Steps:
//   1. Strip any prod DATABASE_URL from the process env — hard safety.
//   2. initdb + start a local PostgreSQL 18 server inside this container.
//   3. Download the newest alma-spa-*.dump from GCS.
//   4. createdb restore_test_<timestamp>; pg_restore the dump into it.
//   5. Count rows in the key tables; compare with the 2026-09-06 baseline.
//   6. Print a clear OK/FALLO verdict and exit non-zero on failure.
//   7. dropdb (cosmetic — the whole container dies right after anyway).
//
// This script NEVER opens a network connection to a Postgres outside the
// container. Every connection goes to 127.0.0.1 on the local instance we
// just spun up.

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { log, scrubConnectionStrings } = require('./helpers');

const POSTGRES_BIN = process.env.POSTGRES_BIN || '/usr/lib/postgresql/18/bin';
const PGDATA = process.env.PGDATA || '/tmp/pgdata';
const HOST = process.env.RESTORE_TEST_HOST || '127.0.0.1';
const PORT = Number(process.env.RESTORE_TEST_PORT || 5432);
const DUMP_DIR = '/tmp/restore-test-dump';
const TEST_DB = `restore_test_${Date.now()}`;
const PG_LOG = '/tmp/pg.log';

// The 2026-09-06 baseline from the production inventory. Used as the
// verdict signal — restored counts must exactly match these.
const EXPECTED_COUNTS = {
  Tenant: 1,
  User: 8,
  Client: 7,
  Appointment: 43,
  Service: 20,
  Room: 11,
  ServiceCategory: 13,
  WhatsAppMessage: 763,
};

// ─── Safety guards ───────────────────────────────────────────────────

function stripDangerousEnv() {
  // The container should not carry any production URL. Strip anything
  // that could accidentally be used as a Postgres destination.
  const dangerous = [
    'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'RESTORE_TEST_ADMIN_URL',
    'PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
  ];
  for (const k of dangerous) {
    if (process.env[k]) {
      log('warn', `env ${k} eliminada del proceso para evitar apuntar fuera del contenedor`, {});
      delete process.env[k];
    }
  }
}

function assertRequiredEnv() {
  if (!process.env.GCS_BUCKET) throw new Error('GCS_BUCKET no configurada');
  if (!process.env.GCS_SERVICE_ACCOUNT_KEY) throw new Error('GCS_SERVICE_ACCOUNT_KEY no configurada');
}

// ─── Postgres lifecycle inside the container ────────────────────────

function suPostgres(cmd) {
  // Postgres refuses to run as root. We shell into the postgres system
  // user (created by the postgresql-18 package) for every server-side op.
  return spawnSync('su', ['-s', '/bin/bash', 'postgres', '-c', cmd], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

function initCluster() {
  log('info', 'initdb: creando cluster local temporal', { pgdata: PGDATA });
  // PGDATA has to exist and be owned by postgres BEFORE initdb runs.
  fs.mkdirSync(PGDATA, { recursive: true });
  spawnSync('chown', ['-R', 'postgres:postgres', PGDATA], { stdio: 'inherit' });
  // trust auth is safe here because the server only listens on 127.0.0.1
  // inside a container that exposes no network ports.
  const cmd = `${POSTGRES_BIN}/initdb -D ${PGDATA} --username=postgres --auth-local=trust --auth-host=trust --encoding=UTF8 --locale=C`;
  const r = suPostgres(cmd);
  if (r.status !== 0) {
    throw new Error(`initdb fallo (exit ${r.status}): ${(r.stderr || '').slice(-500)}`);
  }
}

function startServer() {
  log('info', 'arrancando Postgres local', { host: HOST, port: PORT });
  const opts = `-c listen_addresses='${HOST}' -c port=${PORT} -c unix_socket_directories='/tmp' -c fsync=off -c synchronous_commit=off -c full_page_writes=off`;
  const cmd = `${POSTGRES_BIN}/pg_ctl -D ${PGDATA} -l ${PG_LOG} -o "${opts}" start`;
  const r = suPostgres(cmd);
  if (r.status !== 0) {
    let pglog = '';
    try { pglog = fs.readFileSync(PG_LOG, 'utf8').slice(-500); } catch (_) { /* ignore */ }
    throw new Error(`pg_ctl start fallo (exit ${r.status}): ${(r.stderr || '').slice(-500)} | pg.log: ${pglog}`);
  }
}

async function waitReady() {
  for (let i = 0; i < 30; i++) {
    const r = spawnSync(`${POSTGRES_BIN}/pg_isready`, ['-h', HOST, '-p', String(PORT), '-U', 'postgres'], { stdio: 'ignore' });
    if (r.status === 0) return;
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error('Postgres no respondio pg_isready en 15s');
}

function stopServer() {
  const cmd = `${POSTGRES_BIN}/pg_ctl -D ${PGDATA} -m fast stop`;
  suPostgres(cmd);
}

function psqlExec(dbName, sql) {
  return spawnSync(
    process.env.PSQL_PATH || `${POSTGRES_BIN}/psql`,
    ['-h', HOST, '-p', String(PORT), '-U', 'postgres', '-d', dbName, '-tAX', '-c', sql],
    { encoding: 'utf8' }
  );
}

function createTempDb() {
  log('info', 'creando database temporal', { db: TEST_DB });
  const r = psqlExec('postgres', `CREATE DATABASE "${TEST_DB}"`);
  if (r.status !== 0) {
    throw new Error(`CREATE DATABASE fallo: ${(r.stderr || '').slice(-500)}`);
  }
}

function dropTempDb() {
  // Cosmetic — the container dies anyway. But we DROP explicitly to leave
  // the local cluster in a clean state if the caller ever changes the
  // lifecycle (e.g. reuses the image for multiple runs).
  try {
    psqlExec('postgres', `DROP DATABASE IF EXISTS "${TEST_DB}"`);
  } catch (_) { /* ignore */ }
}

// ─── Restore + verify ───────────────────────────────────────────────

function runRestore(dumpPath) {
  log('info', 'pg_restore en curso', { db: TEST_DB, dump: path.basename(dumpPath) });
  const bin = process.env.PG_RESTORE_PATH || `${POSTGRES_BIN}/pg_restore`;
  const args = [
    '-h', HOST,
    '-p', String(PORT),
    '-U', 'postgres',
    '-d', TEST_DB,
    '--no-owner',
    '--no-acl',
    '--exit-on-error',
    dumpPath,
  ];
  const r = spawnSync(bin, args, { encoding: 'utf8' });
  const stderr = scrubConnectionStrings(r.stderr || '').slice(-2000);
  if (r.status !== 0) {
    throw new Error(`pg_restore fallo (exit ${r.status})\n${stderr}`);
  }
  if (stderr.trim()) {
    // pg_restore may emit non-fatal warnings even on success (e.g. missing
    // extension for a role). Surface them but don't fail.
    log('warn', 'pg_restore terminado con warnings', { warnings: stderr });
  }
  return { warnings: stderr.trim() || null };
}

function countTables() {
  const results = {};
  for (const table of Object.keys(EXPECTED_COUNTS)) {
    const r = psqlExec(TEST_DB, `SELECT count(*) FROM "${table}"`);
    if (r.status !== 0) {
      const err = scrubConnectionStrings(r.stderr || '').slice(-300);
      results[table] = { error: err || 'count fallo' };
      continue;
    }
    results[table] = { count: parseInt((r.stdout || '').trim(), 10) };
  }
  return results;
}

// Pure — exported for tests. Produces a human-readable diff report and
// an overall boolean.
function compareCounts(expected, actual) {
  const rows = [];
  let allMatch = true;
  for (const [table, exp] of Object.entries(expected)) {
    const cell = actual[table];
    if (cell?.error) {
      rows.push({ table, expected: exp, actual: null, error: cell.error, match: false });
      allMatch = false;
      continue;
    }
    const got = cell?.count;
    const match = got === exp;
    if (!match) allMatch = false;
    rows.push({ table, expected: exp, actual: got, error: null, match });
  }
  return { allMatch, rows };
}

function printReport({ dumpFilename, dumpBytes, warnings, comparison }) {
  console.log('');
  console.log('==============================================================');
  console.log('  VEREDICTO DE RESTAURACION');
  console.log('==============================================================');
  console.log(`  dump:            ${dumpFilename}`);
  console.log(`  tamano:          ${dumpBytes} bytes`);
  console.log(`  db temporal:     ${TEST_DB}`);
  console.log(`  postgres:        ${HOST}:${PORT} (interno del contenedor)`);
  if (warnings) {
    console.log(`  warnings restore: ${warnings.slice(0, 300)}`);
  }
  console.log('  ------------------------------------------------------------');
  console.log(`  ${'Tabla'.padEnd(22)} ${'Esperado'.padStart(10)} ${'Obtenido'.padStart(10)} ${'Match'.padStart(8)}`);
  console.log(`  ${'-'.repeat(22)} ${'-'.repeat(10)} ${'-'.repeat(10)} ${'-'.repeat(8)}`);
  for (const row of comparison.rows) {
    const actualStr = row.error ? `ERR` : String(row.actual);
    const matchStr = row.match ? 'OK' : 'DIFF';
    console.log(`  ${row.table.padEnd(22)} ${String(row.expected).padStart(10)} ${actualStr.padStart(10)} ${matchStr.padStart(8)}`);
    if (row.error) console.log(`    error: ${row.error.slice(0, 200)}`);
  }
  console.log('  ------------------------------------------------------------');
  if (comparison.allMatch) {
    console.log('  ✓ VEREDICTO: OK — el respaldo se restaura correctamente.');
  } else {
    console.log('  ✗ VEREDICTO: FALLO — los conteos NO coinciden con el baseline.');
  }
  console.log('==============================================================');
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  stripDangerousEnv();
  assertRequiredEnv();

  initCluster();
  startServer();
  await waitReady();
  createTempDb();

  const { downloadLatestBackup } = require('./gcsUploader');
  log('info', 'bajando dump mas reciente del bucket', { bucket: process.env.GCS_BUCKET });
  const { filename, localPath, bytes } = await downloadLatestBackup({
    bucket: process.env.GCS_BUCKET,
    keyJson: process.env.GCS_SERVICE_ACCOUNT_KEY,
    destDir: DUMP_DIR,
  });
  log('info', 'dump bajado', { filename, bytes });

  let warnings = null;
  try {
    const r = runRestore(localPath);
    warnings = r.warnings;
  } catch (err) {
    // Print the report shell with the error and exit non-zero.
    console.log('');
    console.log('==============================================================');
    console.log('  ✗ VEREDICTO: FALLO — pg_restore no completo.');
    console.log('==============================================================');
    console.log(`  dump:  ${filename}`);
    console.log(`  error: ${err.message}`);
    console.log('==============================================================');
    dropTempDb();
    stopServer();
    process.exit(1);
  }

  const actualCounts = countTables();
  const comparison = compareCounts(EXPECTED_COUNTS, actualCounts);

  printReport({ dumpFilename: filename, dumpBytes: bytes, warnings, comparison });

  dropTempDb();
  stopServer();
  process.exit(comparison.allMatch ? 0 : 1);
}

module.exports = { compareCounts, EXPECTED_COUNTS };

if (require.main === module) {
  main().catch((err) => {
    log('error', 'restore-test FALLIDO', { error: err.message });
    console.log('');
    console.log('==============================================================');
    console.log('  ✗ VEREDICTO: FALLO — error setup/entorno.');
    console.log('==============================================================');
    console.log(`  error: ${err.message}`);
    console.log('==============================================================');
    try { dropTempDb(); } catch (_) {}
    try { stopServer(); } catch (_) {}
    process.exit(1);
  });
}
