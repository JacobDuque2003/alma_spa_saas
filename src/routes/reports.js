const express = require('express');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const { getReport, VALID_METRICS } = require('../services/reportService');

const router = express.Router();

const FINANCIAL_METRICS = ['ingresos-servicio'];
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

router.get('/:metric', authenticate, requirePermission('reportes'), async (req, res, next) => {
  try {
    const { metric } = req.params;
    if (!VALID_METRICS.includes(metric)) {
      return res.status(400).json({ error: `Métrica inválida. Válidas: ${VALID_METRICS.join(', ')}` });
    }

    const fromStr = req.query.from;
    const toStr = req.query.to;
    if (!fromStr || !toStr) {
      return res.status(400).json({ error: 'Parámetros from y to son obligatorios (ISO 8601)' });
    }

    const from = new Date(fromStr);
    const to = new Date(toStr);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ error: 'from o to no son fechas válidas' });
    }
    if (from >= to) {
      return res.status(400).json({ error: 'from debe ser anterior a to' });
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      return res.status(400).json({ error: 'Rango máximo permitido: 366 días' });
    }

    const canSeeFinancials = ['superadmin', 'dueno'].includes(req.user.role);
    if (FINANCIAL_METRICS.includes(metric) && !canSeeFinancials) {
      return res.status(403).json({ error: 'Solo dueño/superadmin pueden ver métricas financieras' });
    }

    const result = await getReport(req.user.tenantId, metric, from, to, req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
