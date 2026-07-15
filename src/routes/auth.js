const express = require('express');
const { login } = require('../services/authService');
const authenticate = require('../middleware/authenticate');
const prisma = require('../utils/prisma');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email y password son requeridos' });
    }

    const result = await login(email, password);
    if (!result) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, tenantId: true },
    });
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
