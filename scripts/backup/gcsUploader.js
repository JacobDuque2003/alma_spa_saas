// Isolated GCS upload wrapper. Kept in its own file so tests that only
// exercise pure helpers do not need @google-cloud/storage installed.
//
// The service account key arrives as the full JSON contents in
// GCS_SERVICE_ACCOUNT_KEY. It is parsed here and passed to the Storage
// client via the `credentials` option — never written to disk, never logged.

function parseServiceAccountKey(keyJson) {
  try {
    const parsed = JSON.parse(keyJson);
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error('faltan campos requeridos (project_id, client_email, private_key)');
    }
    return parsed;
  } catch (err) {
    // The error message NEVER includes keyJson content — only the shape check.
    throw new Error(`GCS_SERVICE_ACCOUNT_KEY invalida: ${err.message}`);
  }
}

async function uploadBackup({ localPath, bucket, filename, keyJson }) {
  // Lazy require so this module can be loaded without @google-cloud/storage
  // installed (e.g. during CI tests of helpers only).
  const { Storage } = require('@google-cloud/storage');

  const credentials = parseServiceAccountKey(keyJson);
  const storage = new Storage({
    projectId: credentials.project_id,
    credentials,
  });

  await storage.bucket(bucket).upload(localPath, {
    destination: filename,
    resumable: false,
    metadata: {
      contentType: 'application/octet-stream',
      metadata: {
        source: 'alma-spa-backup',
        createdAt: new Date().toISOString(),
      },
    },
  });
}

// Downloads the newest backup .dump from the bucket to a local path. Used
// only by the restore-test container — never touches production Postgres.
// Returns { filename, localPath, bytes }. Throws if the bucket is empty.
async function downloadLatestBackup({ bucket, keyJson, destDir }) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { Storage } = require('@google-cloud/storage');

  const credentials = parseServiceAccountKey(keyJson);
  const storage = new Storage({
    projectId: credentials.project_id,
    credentials,
  });

  // List every alma-spa-YYYY-MM-DD.dump and pick the newest by name — since
  // the date is ISO the string sort matches chronological order.
  const [files] = await storage.bucket(bucket).getFiles({ prefix: 'alma-spa-' });
  const dumps = files.filter((f) => f.name.endsWith('.dump'));
  if (dumps.length === 0) {
    throw new Error(`el bucket ${bucket} no contiene ningun alma-spa-*.dump`);
  }
  dumps.sort((a, b) => (a.name < b.name ? 1 : -1));
  const latest = dumps[0];

  fs.mkdirSync(destDir, { recursive: true });
  const localPath = path.join(destDir, path.basename(latest.name));
  await latest.download({ destination: localPath });
  const bytes = fs.statSync(localPath).size;
  return { filename: latest.name, localPath, bytes };
}

module.exports = { uploadBackup, parseServiceAccountKey, downloadLatestBackup };
