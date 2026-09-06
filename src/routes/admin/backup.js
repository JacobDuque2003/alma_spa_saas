// Manual trigger for the daily backup — superadmin only.
// Intended for testing without waiting for the cron to fire.

const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { runBackup } = require('../../../scripts/backup/run');

const router = express.Router();

router.post('/run', authenticate, async (req, res) => {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Solo superadmin puede disparar backups' });
  }

  try {
    const result = await runBackup();
    // runBackup returns { filename, bytes, bucket } — no secrets.
    return res.json({ ok: true, ...result });
  } catch (err) {
    // err.message is already scrubbed by runPgDump / gcsUploader. Never
    // include env values or the error's own stack in the HTTP response.
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
