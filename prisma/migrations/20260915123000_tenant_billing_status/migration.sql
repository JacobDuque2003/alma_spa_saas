CREATE TYPE "TenantBillingStatus" AS ENUM ('active', 'grace', 'suspended');

ALTER TABLE "Tenant"
  ADD COLUMN "billingStatus" "TenantBillingStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "billingDueAt" TIMESTAMP(3),
  ADD COLUMN "billingGraceUntil" TIMESTAMP(3),
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspensionReason" TEXT;

CREATE INDEX "Tenant_billingStatus_idx" ON "Tenant"("billingStatus");

ALTER TYPE "AuditEntity" ADD VALUE 'tenant';
ALTER TYPE "AuditAction" ADD VALUE 'billingStatusChanged';
