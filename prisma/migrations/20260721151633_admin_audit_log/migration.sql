-- CreateEnum
CREATE TYPE "AuditEntity" AS ENUM ('user', 'service', 'room', 'category');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'activate', 'deactivate', 'purge', 'permissionsChanged');

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "entity" "AuditEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditLog_tenantId_createdAt_idx" ON "AdminAuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_tenantId_entity_createdAt_idx" ON "AdminAuditLog"("tenantId", "entity", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_tenantId_actorId_createdAt_idx" ON "AdminAuditLog"("tenantId", "actorId", "createdAt");
