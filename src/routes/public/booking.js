const express = require('express');
const prisma = require('../../utils/prisma');
const resolvePublicTenant = require('../../middleware/resolvePublicTenant');
const { ipRateLimit, ipTenantRateLimit } = require('../../middleware/publicRateLimit');
const clientService = require('../../services/clientService');
const appointmentService = require('../../services/appointmentService');
const { customerServiceWhere, isCustomerService, hasConfirmedPrice, formatCustomerPrice } = require('../../utils/customerServicePolicy');

const router = express.Router({ mergeParams: true });

router.use(resolvePublicTenant);

router.get('/services', ipRateLimit, async (req, res, next) => {
  try {
    const services = await prisma.service.findMany({
      where: customerServiceWhere(req.publicTenant.id),
      select: { id: true, name: true, category: true, parentServiceId: true, durationMins: true, bufferMins: true, colorHex: true, priceUsd: true, description: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    res.json(services.filter(isCustomerService).map((service) => ({
      ...service,
      priceLabel: formatCustomerPrice(service.priceUsd),
      requiresAdvisor: !hasConfirmedPrice(service),
    })));
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
      publicOnly: true,
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
    const { appointments } = await appointmentService.createPublicBooking(req.publicTenant.id, req.body);
    res.status(201).json({
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
