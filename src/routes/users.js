const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const protectSuperadmin = require('../middleware/protectSuperadmin');
const userService = require('../services/userService');

const router = express.Router();

router.use(authenticate, requireRole('superadmin', 'dueno'));


router.get('/', async (req, res, next) => {
  try {
    const users = await userService.listUsers(req.user, req.query);
    res.json(users);
  } catch (err) {
    next(err);
  }
});


router.post('/', async (req, res, next) => {
  try {
    const user = await userService.createUser(req.user, req.body);
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', protectSuperadmin, async (req, res, next) => {
  try {
    const user = await userService.updateUser(req.user, req.params.id, req.body);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', protectSuperadmin, async (req, res, next) => {
  try {
    const user = await userService.deleteUser(req.user, req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/permissions', protectSuperadmin, async (req, res, next) => {
  try {
    const permissions = await userService.updatePermissions(req.user, req.params.id, req.body);
    if (!permissions) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(permissions);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
