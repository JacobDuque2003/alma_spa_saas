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

// Binario separado del JSON del servicio (ver serviceService.getServiceImage).
// ETag fuerte derivado de imageUpdatedAt: cambia exactamente cuando la imagen
// cambia, así que el navegador (y más adelante el bot de WhatsApp) puede
// revalidar con un 304 en vez de re-descargar la misma foto en cada request.
router.get('/:id/image', async (req, res, next) => {
  try {
    const result = await serviceService.getServiceImage(req.user, req.params.id);
    if (!result) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (!result.image) return res.status(404).json({ error: 'Este servicio no tiene imagen' });

    const { data, mimeType, updatedAt } = result.image;
    const etag = `"${req.params.id}-${updatedAt ? new Date(updatedAt).getTime() : 0}"`;
    res.set('ETag', etag);
    res.set('Cache-Control', 'public, max-age=86400, must-revalidate');
    if (req.get('If-None-Match') === etag) {
      return res.status(304).end();
    }
    res.set('Content-Type', mimeType);
    res.send(data);
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
