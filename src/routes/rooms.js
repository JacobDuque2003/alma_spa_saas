const express = require('express');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const requireAnyPermission = require('../middleware/requireAnyPermission');
const roomService = require('../services/roomService');

const router = express.Router();

router.get('/', authenticate, requireAnyPermission('gabinetes', 'configuracion'), async (req, res, next) => {
  try {
    const rooms = await roomService.listRooms(req.user, req.query);
    res.json(rooms);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, requirePermission('configuracion'), async (req, res, next) => {
  try {
    const room = await roomService.getRoom(req.user, req.params.id);
    if (!room) return res.status(404).json({ error: 'Gabinete no encontrado' });
    res.json(room);
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, requirePermission('configuracion'), async (req, res, next) => {
  try {
    const room = await roomService.createRoom(req.user, req.body);
    res.status(201).json(room);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', authenticate, requirePermission('configuracion'), async (req, res, next) => {
  try {
    const room = await roomService.updateRoom(req.user, req.params.id, req.body);
    if (!room) return res.status(404).json({ error: 'Gabinete no encontrado' });
    res.json(room);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, requirePermission('configuracion'), async (req, res, next) => {
  try {
    const room = await roomService.deleteRoom(req.user, req.params.id);
    if (!room) return res.status(404).json({ error: 'Gabinete no encontrado' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
