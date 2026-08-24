-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'pendiente_bot';

-- AlterTable
ALTER TABLE "WhatsAppConversation" ADD COLUMN     "botActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "botState" JSONB;

-- CreateTable
CREATE TABLE "BotInteractionLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerWaId" TEXT NOT NULL,
    "userMessage" TEXT,
    "detectedIntent" TEXT,
    "botReplyText" TEXT,
    "model" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotInteractionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotInteractionLog_tenantId_conversationId_createdAt_idx" ON "BotInteractionLog"("tenantId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "BotInteractionLog_tenantId_createdAt_idx" ON "BotInteractionLog"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "BotInteractionLog" ADD CONSTRAINT "BotInteractionLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotInteractionLog" ADD CONSTRAINT "BotInteractionLog_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
