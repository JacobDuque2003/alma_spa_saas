const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const service = require('../services/almitaCenterService');
const { BadRequestError } = require('../utils/errors');

const router = express.Router();
router.use(authenticate, requireRole('superadmin'));

function tenantIdFrom(req) {
  const queryTenantId = req.query?.tenantId;
  const bodyTenantId = req.body?.tenantId;
  if (queryTenantId && bodyTenantId && queryTenantId !== bodyTenantId) {
    throw new BadRequestError('tenantId no coincide entre query y body');
  }
  return bodyTenantId || queryTenantId;
}

function route(handler, status = 200) {
  return async (req, res, next) => {
    try {
      const result = await handler(req);
      if (status === 204) return res.status(204).send();
      return res.status(status).json(result);
    } catch (err) {
      return next(err);
    }
  };
}

router.get('/configurations', route((req) => service.listConfigurations(req.user, tenantIdFrom(req))));
router.get('/configuration', route((req) => service.getActiveConfiguration(req.user, tenantIdFrom(req))));
router.post('/configurations', route((req) => service.createConfiguration(req.user, tenantIdFrom(req), req.body || {}), 201));
router.patch('/configurations/:id', route((req) => service.updateConfiguration(req.user, tenantIdFrom(req), req.params.id, req.body || {}), 201));
router.delete('/configurations/:id', route((req) => service.deleteConfiguration(req.user, tenantIdFrom(req), req.params.id), 204));

router.get('/knowledge', route(async (req) => {
  const result = await service.listKnowledge(req.user, tenantIdFrom(req), req.query);
  return { tenant: result.tenant, knowledge: result.rows };
}));
router.post('/knowledge', route((req) => service.createKnowledge(req.user, tenantIdFrom(req), req.body || {}), 201));
router.patch('/knowledge/:id', route((req) => service.updateKnowledge(req.user, tenantIdFrom(req), req.params.id, req.body || {})));
router.delete('/knowledge/:id', route((req) => service.deleteKnowledge(req.user, tenantIdFrom(req), req.params.id), 204));

router.get('/examples', route(async (req) => {
  const result = await service.listExamples(req.user, tenantIdFrom(req), req.query);
  return { tenant: result.tenant, examples: result.rows };
}));
router.post('/examples', route((req) => service.createExample(req.user, tenantIdFrom(req), req.body || {}), 201));
router.patch('/examples/:id', route((req) => service.updateExample(req.user, tenantIdFrom(req), req.params.id, req.body || {})));
router.delete('/examples/:id', route((req) => service.deleteExample(req.user, tenantIdFrom(req), req.params.id), 204));

router.post('/simulate', route((req) => service.simulate(req.user, tenantIdFrom(req), req.body || {})));
router.get('/metrics', route((req) => service.getMetrics(req.user, tenantIdFrom(req), req.query)));

module.exports = router;
