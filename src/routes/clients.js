const express = require('express');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const requireAnyPermission = require('../middleware/requireAnyPermission');
const requireRole = require('../middleware/requireRole');
const clientService = require('../services/clientService');
const clientIntakeService = require('../services/clientIntakeService');
const treatmentHistoryService = require('../services/treatmentHistoryService');
const clientPlanService = require('../services/clientPlanService');
const ledgerService = require('../services/ledgerService');
const clientImportService = require('../services/clientImportService');

const router = express.Router();

// authenticate se aplica por-ruta (no como router.use global): este router se
// monta en '/', así que un middleware global aquí correría para TODAS las
// requests —incluidas las rutas públicas montadas después— exigiendo token.
const clientes = [authenticate, requirePermission('clientes')];
const clientEdit = [authenticate, requirePermission('clientes'), requirePermission('clientesEditar')];
const clientIntakeEdit = [authenticate, requirePermission('clientes'), requirePermission('clientesAnamnesis')];
const clientHistoryEdit = [authenticate, requirePermission('clientes'), requirePermission('clientesHistorial')];
const clientStatusEdit = [authenticate, requirePermission('clientes'), requirePermission('clientesEstado')];
const clientDelete = [authenticate, requirePermission('clientes'), requirePermission('clientesEliminar')];
const clientPayments = [authenticate, requirePermission('clientes'), requirePermission('clientesPagos')];
const clientExport = [authenticate, requirePermission('clientes'), requireAnyPermission('clientesExportar', 'reportes', 'configuracion')];
const ownerOnly = [authenticate, requireRole('superadmin', 'dueno')];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Evita que un valor importado (por ejemplo una dirección que empieza con
  // '=') se ejecute como fórmula al abrir la exportación en Excel.
  const formulaLike = /^[=@]/.test(text)
    || (/^[+-]/.test(text) && !/^\+\d{7,15}$/.test(text));
  const safe = formulaLike ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function clientsToCsv(clients) {
  const columns = [
    ['recordNumber', 'Ficha'],
    ['fullName', 'Nombre'],
    ['whatsapp', 'WhatsApp'],
    ['email', 'Email'],
    ['address', 'Dirección'],
    ['cedula', 'Cédula'],
    ['birthday', 'Cumpleaños'],
    ['age', 'Edad'],
    ['active', 'Estado'],
    ['createdAt', 'Cliente desde'],
  ];
  const header = columns.map(([, label]) => csvCell(label)).join(',');
  const rows = clients.map((client) => columns.map(([key]) => {
    if (key === 'active') return csvCell(client.active === false ? 'Deshabilitada' : 'Activa');
    return csvCell(client[key]);
  }).join(','));
  return `\uFEFF${[header, ...rows].join('\n')}`;
}

// Log de seguridad para intentos cross-tenant (403) sobre datos de salud —
// NO se escribe en ClientIntakeAuditLog (ese log es de accesos legítimos a un
// cliente real, no de intentos de acceso a un clientId ajeno).
function logCrossTenant(req, err) {
  if (err && err.status === 403) {
    console.warn('[SECURITY] intento cross-tenant sobre anamnesis', {
      actorId: req.user?.id,
      actorTenantId: req.user?.tenantId,
      clientId: req.params.clientId,
      path: req.originalUrl,
    });
  }
}


// --- Clientes (datos base, sin anamnesis) ---

router.get('/clients', clientes, async (req, res, next) => {
  try {
    const clients = await clientService.listClients(req.user, req.query);
    res.json(clients);
  } catch (err) {
    next(err);
  }
});

router.post('/clients', clientEdit, async (req, res, next) => {
  try {
    const client = await clientService.createClient(req.user, req.body);
    res.status(201).json(client);
  } catch (err) {
    next(err);
  }
});

// Se monta ANTES de /clients/:clientId para que Express no interprete
// "birthdays" como un clientId literal.
router.get('/clients/birthdays', clientes, async (req, res, next) => {
  try {
    const days = req.query.days !== undefined ? Number(req.query.days) : 7;
    const rows = await clientService.listUpcomingBirthdays(req.user, days);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/clients/export', clientExport, async (req, res, next) => {
  try {
    const clients = await clientService.exportClients(req.user, req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clientes-alma-spa.csv"');
    res.send(clientsToCsv(clients));
  } catch (err) {
    next(err);
  }
});

// Se declara antes de /clients/:clientId para que "therapists" no sea tomado
// como un identificador de ficha.
router.get('/clients/therapists', clientHistoryEdit, async (req, res, next) => {
  try {
    res.json(await treatmentHistoryService.listAvailableTherapists(req.user));
  } catch (err) {
    next(err);
  }
});

router.post('/clients/import/preview', clientEdit, async (req, res, next) => {
  try {
    res.json(await clientImportService.previewImport(req.user, req.body?.fileData));
  } catch (err) {
    next(err);
  }
});

router.post('/clients/import', clientEdit, async (req, res, next) => {
  try {
    res.json(await clientImportService.importClients(req.user, req.body?.fileData));
  } catch (err) {
    next(err);
  }
});

router.get('/clients/:clientId', clientes, async (req, res, next) => {
  try {
    const client = await clientService.getClient(req.user, req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(client);
  } catch (err) {
    logCrossTenant(req, err);
    next(err);
  }
});

router.patch('/clients/:clientId', clientEdit, async (req, res, next) => {
  try {
    const client = await clientService.updateClient(req.user, req.params.clientId, req.body);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(client);
  } catch (err) {
    logCrossTenant(req, err);
    next(err);
  }
});

router.patch('/clients/:clientId/disable', clientStatusEdit, async (req, res, next) => {
  try {
    const client = await clientService.deleteClient(req.user, req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ ok: true, client });
  } catch (err) {
    logCrossTenant(req, err);
    next(err);
  }
});

router.patch('/clients/:clientId/enable', clientStatusEdit, async (req, res, next) => {
  try {
    const client = await clientService.enableClient(req.user, req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ ok: true, client });
  } catch (err) {
    logCrossTenant(req, err);
    next(err);
  }
});
router.delete('/clients/:clientId', clientDelete, async (req, res, next) => {
  try {
    const client = await clientService.deleteClient(req.user, req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ ok: true, client });
  } catch (err) {
    logCrossTenant(req, err);
    next(err);
  }
});

// --- Anamnesis (ClientIntake) ---

router.get('/clients/:clientId/intake', clientes, async (req, res, next) => {
  try {
    const intake = await clientIntakeService.getIntakeForActor(req.user, req.params.clientId);
    if (!intake) return res.status(404).json({ error: 'Ficha de anamnesis no encontrada' });
    res.json(intake);
  } catch (err) {
    logCrossTenant(req, err);
    next(err);
  }
});

router.put('/clients/:clientId/intake', clientIntakeEdit, async (req, res, next) => {
  try {
    const result = await clientIntakeService.updateIntakeForActor(req.user, req.params.clientId, req.body);
    if (!result) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result);
  } catch (err) {
    logCrossTenant(req, err);
    next(err);
  }
});

router.get('/clients/:clientId/intake/audit', ownerOnly, async (req, res, next) => {
  try {
    const log = await clientIntakeService.getIntakeAuditLog(req.user, req.params.clientId);
    if (!log) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(log);
  } catch (err) {
    logCrossTenant(req, err);
    next(err);
  }
});

// --- Historial de tratamientos ---

router.get('/clients/:clientId/treatments', clientes, async (req, res, next) => {
  try {
    const treatments = await treatmentHistoryService.listTreatments(req.user, req.params.clientId);
    if (!treatments) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(treatments);
  } catch (err) {
    next(err);
  }
});

router.post('/clients/:clientId/treatments', clientHistoryEdit, async (req, res, next) => {
  try {
    const treatment = await treatmentHistoryService.createTreatment(req.user, req.params.clientId, req.body);
    if (!treatment) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.status(201).json(treatment);
  } catch (err) {
    next(err);
  }
});

router.patch('/treatments/:id', clientHistoryEdit, async (req, res, next) => {
  try {
    const treatment = await treatmentHistoryService.updateTreatment(req.user, req.params.id, req.body);
    if (!treatment) return res.status(404).json({ error: 'Tratamiento no encontrado' });
    res.json(treatment);
  } catch (err) {
    next(err);
  }
});

router.delete('/treatments/:id', clientHistoryEdit, async (req, res, next) => {
  try {
    const result = await treatmentHistoryService.deleteTreatment(req.user, req.params.id);
    if (!result) return res.status(404).json({ error: 'Tratamiento no encontrado' });
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});

// --- Planes de cliente ---

router.get('/clients/:clientId/plans', clientes, async (req, res, next) => {
  try {
    const plans = await clientPlanService.listPlans(req.user, req.params.clientId);
    if (!plans) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

router.post('/clients/:clientId/plans', clientPayments, async (req, res, next) => {
  try {
    const plan = await clientPlanService.contractPlan(req.user, req.params.clientId, req.body);
    if (!plan) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.status(201).json(plan);
  } catch (err) {
    next(err);
  }
});

router.post('/client-plans/:id/consume', clientHistoryEdit, async (req, res, next) => {
  try {
    const plan = await clientPlanService.consumeSession(req.user, req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan de cliente no encontrado' });
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.post('/client-plans/:id/renew', clientPayments, async (req, res, next) => {
  try {
    const plan = await clientPlanService.renewPlan(req.user, req.params.id, req.body);
    if (!plan) return res.status(404).json({ error: 'Plan de cliente no encontrado' });
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

// --- Saldo / ledger ---

router.get('/clients/:clientId/balance', clientes, async (req, res, next) => {
  try {
    const balance = await ledgerService.getBalance(req.user, req.params.clientId);
    if (!balance) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(balance);
  } catch (err) {
    next(err);
  }
});

router.post('/clients/:clientId/charges', clientPayments, async (req, res, next) => {
  try {
    const entry = await ledgerService.registerCharge(req.user, req.params.clientId, req.body);
    if (!entry) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

router.post('/clients/:clientId/payments', clientPayments, async (req, res, next) => {
  try {
    const entry = await ledgerService.registerPayment(req.user, req.params.clientId, req.body);
    if (!entry) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

router.post('/ledger/:id/reverse', ownerOnly, async (req, res, next) => {
  try {
    const entry = await ledgerService.reverseEntry(req.user, req.params.id);
    if (!entry) return res.status(404).json({ error: 'Asiento no encontrado' });
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
