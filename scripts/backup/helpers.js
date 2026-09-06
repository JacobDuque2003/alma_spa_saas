// Pure helpers for the backup script. No external deps — safe to require
// from tests without pulling @google-cloud/storage.

const TZ = 'America/Guayaquil';

// YYYY-MM-DD in America/Guayaquil, used for the dump filename.
function todayInGuayaquil(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

function backupFilename(now = new Date()) {
  return `alma-spa-${todayInGuayaquil(now)}.dump`;
}

// Any postgres/postgresql URI in a string is replaced by [REDACTED].
// Used to scrub pg_dump stderr and error messages so DATABASE_URL never
// reaches logs or HTTP responses.
function scrubConnectionStrings(str) {
  if (str == null) return '';
  return String(str).replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[REDACTED]');
}

// [BACKUP] structured log line. Never accepts DATABASE_URL or key material as
// values — callers must not pass them. Prints JSON so Railway logs stay
// parseable.
function log(level, msg, meta = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  if (level === 'error') {
    console.error(`[BACKUP] ${line}`);
  } else {
    console.log(`[BACKUP] ${line}`);
  }
}

module.exports = { TZ, todayInGuayaquil, backupFilename, scrubConnectionStrings, log };
