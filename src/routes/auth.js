const express = require('express');
const { login } = require('../services/authService');

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

module.exports = router;
