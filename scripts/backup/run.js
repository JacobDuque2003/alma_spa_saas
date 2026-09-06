// Daily PostgreSQL backup → Google Cloud Storage.
//
// Uses pg_dump from PATH (must be v18 to dump PostgreSQL 18 — installed via
// nixpacks.toml at repo root). Dump is written to a temp file in os.tmpdir(),
// uploaded to GCS with @google-cloud/storage, then the temp file is deleted.
//
// Env required:
//   DATABASE_URL              — postgres:// URI (never logged, scrubbed on error)
//   GCS_BUCKET                — target bucket name
//   GCS_SERVICE_ACCOUNT_KEY   — full JSON of the service-account key
//
// Retention is managed by GCS lifecycle rules (30 days) — this script never
// lists or deletes remote objects.
//
// Entry points:
//   node scripts/backup/run.js         → one-shot backup (cron / npm run backup:run)
//   const { runBackup } = require...   → programmatic (used by /admin/backup/run)

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { backupFilename, scrubConnectionStrings, log } = require('./helpers');

function assertEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === '') {
    throw new Error(`${name} no configurada`);
  }
  return value;
}

function runPgDump(dbUrl, tmpPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '--format=custom',
      '--compress=9',
      '--no-owner',
      '--no-acl',
      '--file', tmpPath,
      dbUrl,
    ];
    const proc = spawn('pg_dump', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    // pg_dump on stderr may echo the connection URI on connection failures.
    // We buffer it, then scrub it before logging or throwing.
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });

    proc.on('error', (err) => {
      reject(new Error(`pg_dump no pudo ejecutarse (¿instalado?): ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) return resolve();
      const safe = scrubConnectionStrings(stderr).slice(-500);
      reject(new Error(`pg_dump fallo (exit ${code}): ${safe || 'sin stderr'}`));
    });
  });
}

async function runBackup() {
  const dbUrl = assertEnv('DATABASE_URL');
  const bucket = assertEnv('GCS_BUCKET');
  const keyJson = assertEnv('GCS_SERVICE_ACCOUNT_KEY');

  const filename = backupFilename();
  const tmpPath = path.join(os.tmpdir(), filename);

  // Do NOT log dbUrl, keyJson, or any of their values under any circumstances.
  log('info', 'iniciando backup', { filename, bucket });

  const dumpStart = Date.now();
  try {
    await runPgDump(dbUrl, tmpPath);
  } catch (err) {
    // Best-effort cleanup if pg_dump partially wrote a file.
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_e) { /* ignore */ }
    // err.message is already scrubbed by runPgDump.
    log('error', 'pg_dump fallo', { filename, error: err.message });
    throw err;
  }

  const stat = fs.statSync(tmpPath);
  log('info', 'pg_dump completado', {
    filename,
    bytes: stat.size,
    dumpMs: Date.now() - dumpStart,
  });

  const uploadStart = Date.now();
  try {
    const { uploadBackup } = require('./gcsUploader');
    await uploadBackup({ localPath: tmpPath, bucket, filename, keyJson });
    log('info', 'upload GCS completado', {
      filename,
      bucket,
      bytes: stat.size,
      uploadMs: Date.now() - uploadStart,
    });
  } catch (err) {
    log('error', 'upload GCS fallo', { filename, error: err.message });
    throw new Error(`upload GCS fallo: ${err.message}`);
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch (err) {
      log('warn', 'no pude borrar archivo temporal', { path: tmpPath, error: err.message });
    }
  }

  return { filename, bytes: stat.size, bucket };
}

module.exports = { runBackup };

// CLI entry point — for `npm run backup:run` or Railway Cron.
if (require.main === module) {
  runBackup()
    .then((result) => {
      log('info', 'backup OK', result);
      process.exit(0);
    })
    .catch((err) => {
      log('error', 'backup FALLIDO', { error: err.message });
      process.exit(1);
    });
}
