const express = require('express');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const planService = require('../services/planService');

const router = express.Router();

router.use(authenticate);

router.get('/', requirePermission('configuracion'), async (req, res, next) => {
  try {
    const plans = await planService.listPlans(req.user, req.query);
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('configuracion'), async (req, res, next) => {
  try {
    const plan = await planService.getPlan(req.user, req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('configuracionServicios'), async (req, res, next) => {
  try {
    const plan = await planService.createPlan(req.user, req.body);
    res.status(201).json(plan);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requirePermission('configuracionServicios'), async (req, res, next) => {
  try {
    const plan = await planService.updatePlan(req.user, req.params.id, req.body);
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('configuracionServicios'), async (req, res, next) => {
  try {
    const plan = await planService.deletePlan(req.user, req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
