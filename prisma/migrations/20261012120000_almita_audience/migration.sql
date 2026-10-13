-- Existing editorial content stays internal until explicitly approved for clients.
CREATE TYPE "AlmitaAudience" AS ENUM ('INTERNAL', 'PUBLIC');

ALTER TABLE "AlmitaKnowledge"
    ADD COLUMN "audience" "AlmitaAudience" NOT NULL DEFAULT 'INTERNAL';
ALTER TABLE "AlmitaApprovedExample"
    ADD COLUMN "audience" "AlmitaAudience" NOT NULL DEFAULT 'INTERNAL';

CREATE INDEX "AlmitaKnowledge_tenantId_audience_active_priority_idx"
    ON "AlmitaKnowledge"("tenantId", "audience", "active", "priority" DESC);
CREATE INDEX "AlmitaApprovedExample_tenantId_audience_active_updatedAt_idx"
    ON "AlmitaApprovedExample"("tenantId", "audience", "active", "updatedAt" DESC);
