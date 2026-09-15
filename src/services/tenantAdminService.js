const prisma = require('../utils/prisma');
const { AppError, BadRequestError } = require('../utils/errors');
const { pickSafe, writeAuditLog } = require('../utils/adminAudit');

const BILLING_STATUSES = new Set(['active', 'grace', 'suspended']);
const MAX_REASON_LENGTH = 300;

function assertSuperadmin(actor) {
  if (actor?.role !== 'superadmin') {
    throw new AppError('Solo superadmin puede administrar negocios', 403);
  }
}

function parseOptionalDate(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestError(`${field} debe ser una fecha válida`);
  }
  return date;
}

function normalizeReason(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const reason = String(value).trim();
  if (!reason) return null;
  if (reason.length > MAX_REASON_LENGTH) {
    throw new BadRequestError(`suspensionReason no puede exceder ${MAX_REASON_LENGTH} caracteres`);
  }
  return reason;
}

function serializeTenant(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    active: row.active,
    billingStatus: row.billingStatus,
    billingDueAt: row.billingDueAt,
    billingGraceUntil: row.billingGraceUntil,
    suspendedAt: row.suspendedAt,
    suspensionReason: row.suspensionReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    usersCount: row._count?.users ?? 0,
    conversationsCount: row._count?.whatsappConversations ?? 0,
  };
}

async function listTenants(actor) {
  assertSuperadmin(actor);

  const rows = await prisma.tenant.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      active: true,
      billingStatus: true,
      billingDueAt: true,
      billingGraceUntil: true,
      suspendedAt: true,
      suspensionReason: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          users: true,
          whatsappConversations: true,
        },
      },
    },
  });

  return rows.map(serializeTenant);
}

async function updateTenantBilling(actor, tenantId, changes) {
  assertSuperadmin(actor);
  if (!tenantId) throw new BadRequestError('tenantId es requerido');

  const status = changes.billingStatus;
  if (status !== undefined && !BILLING_STATUSES.has(status)) {
    throw new BadRequestError('billingStatus inválido');
  }

  const billingDueAt = parseOptionalDate(changes.billingDueAt, 'billingDueAt');
  const billingGraceUntil = parseOptionalDate(changes.billingGraceUntil, 'billingGraceUntil');
  const suspensionReason = normalizeReason(changes.suspensionReason);
  const plan = changes.plan === undefined ? undefined : String(changes.plan || '').trim();
  if (plan !== undefined && !plan) throw new BadRequestError('plan no puede quedar vacío');

  return prisma.$transaction(async (tx) => {
    const previous = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        active: true,
        billingStatus: true,
        billingDueAt: true,
        billingGraceUntil: true,
        suspendedAt: true,
        suspensionReason: true,
      },
    });
    if (!previous) throw new AppError('Negocio no encontrado', 404);

    const data = {};
    if (plan !== undefined) data.plan = plan;
    if (status !== undefined) data.billingStatus = status;
    if (billingDueAt !== undefined) data.billingDueAt = billingDueAt;
    if (billingGraceUntil !== undefined) data.billingGraceUntil = billingGraceUntil;
    if (suspensionReason !== undefined) data.suspensionReason = suspensionReason;

    const nextStatus = status ?? previous.billingStatus;
    if (nextStatus === 'suspended') {
      data.suspendedAt = previous.suspendedAt || new Date();
    } else if (status !== undefined) {
      data.suspendedAt = null;
      if (suspensionReason === undefined) data.suspensionReason = null;
    }

    if (Object.keys(data).length === 0) {
      return serializeTenant({ ...previous, _count: { users: 0, whatsappConversations: 0 } });
    }

    const updated = await tx.tenant.update({
      where: { id: tenantId },
      data,
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        active: true,
        billingStatus: true,
        billingDueAt: true,
        billingGraceUntil: true,
        suspendedAt: true,
        suspensionReason: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { users: true, whatsappConversations: true } },
      },
    });

    await tx.user.updateMany({
      where: { tenantId },
      data: { sessionVersion: { increment: 1 } },
    });

    await writeAuditLog(tx, {
      actor,
      tenantId,
      entity: 'tenant',
      entityId: tenantId,
      action: previous.billingStatus !== updated.billingStatus ? 'billingStatusChanged' : 'update',
      detail: {
        before: pickSafe('tenant', previous),
        after: pickSafe('tenant', updated),
      },
    });

    return serializeTenant(updated);
  });
}

module.exports = {
  BILLING_STATUSES,
  listTenants,
  updateTenantBilling,
};
