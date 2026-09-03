const express = require('express');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const prisma = require('../utils/prisma');
const { resolveTenantId } = require('../utils/tenantScope');
const { BadRequestError } = require('../utils/errors');
const { normalize: normalizeBusinessHours, validateShape } = require('../utils/businessHours');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateBusinessHours(bh) {
  const err = validateShape(bh);
  if (err) throw new BadRequestError(err);
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
    // Siempre devolvemos el shape nuevo (morning/afternoon); el normalizador
    // se encarga de convertir el shape antiguo o el vacío al canónico.
    res.json({
      businessHours: config.businessHours ? normalizeBusinessHours(config.businessHours) : null,
      workDays: config.workDays || null,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /tenant/config — merge parcial: solo sobreescribe las claves enviadas
// ---------------------------------------------------------------------------
router.patch('/', authenticate, requirePermission('configuracionHorario'), async (req, res, next) => {
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
    if (businessHours !== undefined) {
      // Normalizamos antes de persistir para que la DB siempre guarde el shape
      // nuevo (morning/afternoon). Si el cliente todavía envía el shape antiguo
      // ({start,end}), se convierte a morning único con afternoon=null.
      merged.businessHours = normalizeBusinessHours(businessHours);
    }
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
