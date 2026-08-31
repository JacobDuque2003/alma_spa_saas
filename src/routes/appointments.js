const express = require('express');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const appointmentService = require('../services/appointmentService');
const prisma = require('../utils/prisma');
const { resolveTenantId } = require('../utils/tenantScope');
const agendaEvents = require('../services/crmEventBus');

const router = express.Router();

router.use(authenticate, requirePermission('agenda'));

// La agenda y el CRM comparten el canal de eventos por tenant.  Mantenerlo
// antes de /:id evita que Express interprete "events" como un id de cita.
router.get('/events', (req, res) => {
  agendaEvents.subscribe(req.user.tenantId, res);
});

router.get('/', async (req, res, next) => {
  try {
    const appointments = await appointmentService.listAppointments(req.user, req.query);
    res.json(appointments);
  } catch (err) {
    next(err);
  }
});

router.get('/availability', async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req.user);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const slots = await appointmentService.getAvailability({
      tenantId,
      tenantConfig: tenant?.config || {},
      serviceId: req.query.serviceId,
      date: req.query.date,
      modality: req.query.modality || 'presencial',
    });
    res.json({ slots });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/reschedule-availability', async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req.user);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const slots = await appointmentService.getRescheduleAvailability({
      tenantId,
      tenantConfig: tenant?.config || {},
      appointmentId: req.params.id,
      date: req.query.date,
      roomId: req.query.roomId || undefined,
      staffId: req.query.staffId || undefined,
    });
    res.json({ slots });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const appointment = await appointmentService.getAppointment(req.user, req.params.id);
    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const appointment = await appointmentService.createManualAppointment(req.user, req.body);
    res.status(201).json(appointment);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const appointment = await appointmentService.updateAppointment(req.user, req.params.id, req.body);
    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const appointment = await appointmentService.updateStatus(req.user, req.params.id, req.body.status);
    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
