const express = require('express');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const serviceService = require('../services/serviceService');

const router = express.Router();

router.use(authenticate, requirePermission('configuracion'));

router.get('/', async (req, res, next) => {
  try {
    const services = await serviceService.listServices(req.user, req.query);
    res.json(services);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const service = await serviceService.getService(req.user, req.params.id);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    res.json(service);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const service = await serviceService.createService(req.user, req.body);
    res.status(201).json(service);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const service = await serviceService.updateService(req.user, req.params.id, req.body);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    res.json(service);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const service = await serviceService.deleteService(req.user, req.params.id);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
