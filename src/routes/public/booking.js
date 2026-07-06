const express = require('express');
const prisma = require('../../utils/prisma');
const resolvePublicTenant = require('../../middleware/resolvePublicTenant');
const { ipRateLimit, ipTenantRateLimit } = require('../../middleware/publicRateLimit');
const clientService = require('../../services/clientService');
const appointmentService = require('../../services/appointmentService');

const router = express.Router({ mergeParams: true });

router.use(resolvePublicTenant);

router.get('/services', ipRateLimit, async (req, res, next) => {
  try {
    const services = await prisma.service.findMany({
      where: { tenantId: req.publicTenant.id, active: true },
      select: { id: true, name: true, category: true, durationMins: true, priceUsd: true, offersHomeService: true },
    });
    res.json(services);
  } catch (err) {
    next(err);
  }
});

router.get('/availability', ipRateLimit, async (req, res, next) => {
  try {
    const slots = await appointmentService.getAvailability({
      tenantId: req.publicTenant.id,
      tenantConfig: req.publicTenant.config,
      serviceId: req.query.serviceId,
      date: req.query.date,
      modality: req.query.modality,
    });
    res.json({ slots });
  } catch (err) {
    next(err);
  }
});

router.post('/clients/lookup', ipTenantRateLimit, async (req, res, next) => {
  try {
    if (!req.body.whatsapp) {
      return res.status(400).json({ error: 'whatsapp es requerido' });
    }
    const result = await clientService.lookupClient(req.publicTenant.id, req.body.whatsapp);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/bookings', ipTenantRateLimit, async (req, res, next) => {
  try {
    const { client, appointments } = await appointmentService.createPublicBooking(req.publicTenant.id, req.body);
    res.status(201).json({
      clientId: client.id,
      appointments: appointments.map((a) => ({
        confirmationToken: a.confirmationToken,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        modality: a.modality,
        priceUsd: a.priceUsd,
        status: a.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
