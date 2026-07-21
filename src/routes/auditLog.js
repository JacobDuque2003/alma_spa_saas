const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const prisma = require('../utils/prisma');

const router = express.Router();

router.use(authenticate, requireRole('superadmin', 'dueno'));

router.get('/', async (req, res, next) => {
  try {
    const where = {};

    if (req.user.role === 'superadmin') {
      if (req.query.tenantId) where.tenantId = req.query.tenantId;
    } else {
      where.tenantId = req.user.tenantId;
    }

    if (req.query.entity) where.entity = req.query.entity;
    if (req.query.actorId) where.actorId = req.query.actorId;

    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(req.query.from);
      if (req.query.to) where.createdAt.lte = new Date(req.query.to);
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;

    const [rows, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.adminAuditLog.count({ where }),
    ]);

    res.json({ rows, total, limit, offset });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
