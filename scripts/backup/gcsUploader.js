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

module.exports = { uploadBackup, parseServiceAccountKey };
