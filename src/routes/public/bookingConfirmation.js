const express = require('express');
const { ipRateLimit } = require('../../middleware/publicRateLimit');
const appointmentService = require('../../services/appointmentService');

const router = express.Router();

router.get('/:confirmationToken', ipRateLimit, async (req, res, next) => {
  try {
    const summary = await appointmentService.getBookingByToken(req.params.confirmationToken);
    if (!summary) return res.status(404).json({ error: 'No encontrado' });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.post('/:confirmationToken/cancel', ipRateLimit, async (req, res, next) => {
  try {
    const appointment = await appointmentService.cancelBookingByToken(req.params.confirmationToken);
    if (!appointment) return res.status(404).json({ error: 'No encontrado' });
    res.json({ status: appointment.status });
  } catch (err) {
    next(err);
  }
});

// Fase 5: confirmar por token (endpoint del CTA del recordatorio de WhatsApp).
// Solo pendiente→confirmado; rechaza si ya pasó o está en otro estado.
router.post('/:confirmationToken/confirm', ipRateLimit, async (req, res, next) => {
  try {
    const appointment = await appointmentService.confirmBookingByToken(req.params.confirmationToken);
    if (!appointment) return res.status(404).json({ error: 'No encontrado' });
    res.json({ status: appointment.status });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
