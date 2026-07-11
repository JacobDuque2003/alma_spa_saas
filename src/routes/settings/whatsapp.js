const express = require('express');
const authenticate = require('../../middleware/authenticate');
const requirePermission = require('../../middleware/requirePermission');
const connectionService = require('../../services/whatsappConnectionService');

const router = express.Router();

router.use(authenticate, requirePermission('configuracion'));

router.post('/connect', async (req, res, next) => {
  try {
    const result = await connectionService.replaceConnection(req.user, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/status', async (req, res, next) => {
  try {
    const status = await connectionService.getConnectionStatus(req.user, req.query.tenantId);
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.delete('/', async (req, res, next) => {
  try {
    const result = await connectionService.disconnect(req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
