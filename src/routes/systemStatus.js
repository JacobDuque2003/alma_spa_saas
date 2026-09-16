const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const { getSystemStatus } = require('../services/systemStatusService');

const router = express.Router();

router.get('/status', authenticate, requireRole('superadmin', 'dueno'), async (req, res, next) => {
  try {
    const status = await getSystemStatus(req.user, { tenantId: req.query.tenantId });
    res.json(status);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
