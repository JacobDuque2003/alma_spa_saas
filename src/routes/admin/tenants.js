const express = require('express');
const authenticate = require('../../middleware/authenticate');
const { listTenants, updateTenantBilling } = require('../../services/tenantAdminService');

const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const tenants = await listTenants(req.user);
    res.json({ tenants });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/billing', async (req, res, next) => {
  try {
    const tenant = await updateTenantBilling(req.user, req.params.id, req.body || {});
    res.json({ tenant });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
