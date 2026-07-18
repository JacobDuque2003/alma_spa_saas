const express = require('express');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const prisma = require('../utils/prisma');
const { resolveTenantId } = require('../utils/tenantScope');
const { BadRequestError } = require('../utils/errors');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateBusinessHours(bh) {
  if (typeof bh !== 'object' || bh === null || Array.isArray(bh)) {
    throw new BadRequestError('businessHours debe ser un objeto con start y end');
  }
  if (typeof bh.start !== 'string' || !HH_MM.test(bh.start)) {
    throw new BadRequestError('businessHours.start debe tener formato HH:MM (00:00-23:59)');
  }
  if (typeof bh.end !== 'string' || !HH_MM.test(bh.end)) {
    throw new BadRequestError('businessHours.end debe tener formato HH:MM (00:00-23:59)');
  }
  if (bh.start >= bh.end) {
    throw new BadRequestError('businessHours.start debe ser anterior a businessHours.end');
  }
}

function validateWorkDays(wd) {
  if (!Array.isArray(wd)) {
    throw new BadRequestError('workDays debe ser un arreglo de numeros 0-6');
  }
  for (const d of wd) {
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) {
      throw new BadRequestError('Cada elemento de workDays debe ser un entero entre 0 y 6');
    }
  }
  // Deduplicate and sort for consistency
  const unique = [...new Set(wd)].sort((a, b) => a - b);
  return unique;
}

// ---------------------------------------------------------------------------
// GET /tenant/config — devuelve businessHours y workDays del tenant del actor
// ---------------------------------------------------------------------------
router.get('/', authenticate, requirePermission('configuracion'), async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req.user);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });

    const config = tenant.config || {};
    res.json({
      businessHours: config.businessHours || null,
      workDays: config.workDays || null,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /tenant/config — merge parcial: solo sobreescribe las claves enviadas
// ---------------------------------------------------------------------------
router.patch('/', authenticate, requirePermission('configuracion'), async (req, res, next) => {
  try {
    const { businessHours, workDays } = req.body;

    if (businessHours === undefined && workDays === undefined) {
      throw new BadRequestError('Debe enviar al menos businessHours o workDays');
    }

    if (businessHours !== undefined) validateBusinessHours(businessHours);
    let sanitizedWorkDays;
    if (workDays !== undefined) sanitizedWorkDays = validateWorkDays(workDays);

    const tenantId = resolveTenantId(req.user);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });

    // Merge: spread existing config, then overwrite only the keys sent.
    const existing = tenant.config || {};
    const merged = { ...existing };
    if (businessHours !== undefined) merged.businessHours = businessHours;
    if (workDays !== undefined) merged.workDays = sanitizedWorkDays;

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { config: merged },
    });

    res.json({
      businessHours: merged.businessHours,
      workDays: merged.workDays,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
