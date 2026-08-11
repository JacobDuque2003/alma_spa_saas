const express = require('express');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const clientService = require('../services/clientService');

const router = express.Router();

router.use(authenticate, requirePermission('clientes'));

router.get('/', async (req, res, next) => {
  try {
    const results = await clientService.searchClients(req.user, req.query);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
