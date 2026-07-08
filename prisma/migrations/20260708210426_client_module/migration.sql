-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('cargo', 'pago');

-- CreateEnum
CREATE TYPE "IntakeAuditField" AS ENUM ('allergies', 'conditions', 'consent');

-- CreateEnum
CREATE TYPE "IntakeAuditAction" AS ENUM ('read', 'update');

-- CreateTable
CREATE TABLE "TreatmentHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "appointmentId" TEXT,
    "sessionDate" TIMESTAMP(3) NOT NULL,
    "notesEnc" BYTEA,
    "notesIv" BYTEA,
    "notesTag" BYTEA,
    "productsUsed" TEXT[],
    "photoBeforeUrl" TEXT,
    "photoAfterUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sessionsIncluded" INTEGER NOT NULL,
    "priceUsd" DECIMAL(10,2) NOT NULL,
    "periodMonths" INTEGER NOT NULL,
    "sessionsUsed" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewsAt" TIMESTAMP(3) NOT NULL,
    "isComplimentary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amountUsd" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "method" TEXT,
    "createdById" TEXT NOT NULL,
    "appointmentId" TEXT,
    "treatmentHistoryId" TEXT,
    "clientPlanId" TEXT,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientIntakeAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "field" "IntakeAuditField" NOT NULL,
    "action" "IntakeAuditAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientIntakeAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentHistory_appointmentId_key" ON "TreatmentHistory"("appointmentId");

-- CreateIndex
CREATE INDEX "TreatmentHistory_tenantId_clientId_sessionDate_idx" ON "TreatmentHistory"("tenantId", "clientId", "sessionDate" DESC);

-- CreateIndex
CREATE INDEX "TreatmentHistory_tenantId_therapistId_sessionDate_idx" ON "TreatmentHistory"("tenantId", "therapistId", "sessionDate");

-- CreateIndex
CREATE INDEX "ClientPlan_tenantId_clientId_active_idx" ON "ClientPlan"("tenantId", "clientId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ClientLedgerEntry_reversalOfId_key" ON "ClientLedgerEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "ClientLedgerEntry_tenantId_clientId_createdAt_idx" ON "ClientLedgerEntry"("tenantId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientIntakeAuditLog_tenantId_clientId_createdAt_idx" ON "ClientIntakeAuditLog"("tenantId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientIntakeAuditLog_tenantId_actorId_createdAt_idx" ON "ClientIntakeAuditLog"("tenantId", "actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "TreatmentHistory" ADD CONSTRAINT "TreatmentHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentHistory" ADD CONSTRAINT "TreatmentHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentHistory" ADD CONSTRAINT "TreatmentHistory_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentHistory" ADD CONSTRAINT "TreatmentHistory_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentHistory" ADD CONSTRAINT "TreatmentHistory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentHistory" ADD CONSTRAINT "TreatmentHistory_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentHistory" ADD CONSTRAINT "TreatmentHistory_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPlan" ADD CONSTRAINT "ClientPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPlan" ADD CONSTRAINT "ClientPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPlan" ADD CONSTRAINT "ClientPlan_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLedgerEntry" ADD CONSTRAINT "ClientLedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLedgerEntry" ADD CONSTRAINT "ClientLedgerEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLedgerEntry" ADD CONSTRAINT "ClientLedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
