CREATE TYPE "MetaMessageCategory" AS ENUM ('service', 'utility', 'marketing', 'authentication');
ALTER TABLE "WhatsAppMessage" ADD COLUMN "metaCategory" "MetaMessageCategory";
ALTER TABLE "BotInteractionLog"
  ADD COLUMN "cacheCreationInputTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cacheReadInputTokens" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "AiUsageLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'whatsapp',
  "model" TEXT,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "cacheCreationInputTokens" INTEGER NOT NULL DEFAULT 0,
  "cacheReadInputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "cacheTtl" TEXT,
  "usageKnown" BOOLEAN NOT NULL DEFAULT false,
  "success" BOOLEAN NOT NULL DEFAULT false,
  "errorCode" TEXT,
  "costUsd" DECIMAL(10,6),
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiUsageLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiUsageLog_tenantId_requestId_attempt_key" ON "AiUsageLog"("tenantId", "requestId", "attempt");
CREATE INDEX "AiUsageLog_tenantId_createdAt_idx" ON "AiUsageLog"("tenantId", "createdAt");
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_nonnegative" CHECK (
  "attempt" >= 0 AND "inputTokens" >= 0 AND "cacheCreationInputTokens" >= 0
  AND "cacheReadInputTokens" >= 0 AND "outputTokens" >= 0 AND "latencyMs" >= 0
  AND ("costUsd" IS NULL OR "costUsd" >= 0)
);
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_source" CHECK ("source" IN ('whatsapp', 'simulator'));
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_ttl" CHECK ("cacheTtl" IS NULL OR "cacheTtl" IN ('5m', '1h'));
