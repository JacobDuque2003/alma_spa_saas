CREATE TYPE "WhatsAppConversationStatus" AS ENUM ('open', 'pending', 'resolved', 'archived');

CREATE TYPE "WhatsAppSenderType" AS ENUM ('customer', 'agent', 'bot', 'system');

ALTER TABLE "WhatsAppConversation"
ADD COLUMN "unreadRestoreCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "manuallyMarkedUnread" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "status" "WhatsAppConversationStatus" NOT NULL DEFAULT 'open',
ADD COLUMN "assignedToUserId" TEXT,
ADD COLUMN "botPausedUntil" TIMESTAMP(3);

UPDATE "WhatsAppConversation"
SET "status" = CASE
  WHEN "archived" = true THEN 'archived'::"WhatsAppConversationStatus"
  WHEN "unreadCount" > 0 THEN 'pending'::"WhatsAppConversationStatus"
  ELSE 'open'::"WhatsAppConversationStatus"
END,
"unreadRestoreCount" = GREATEST("unreadCount", 0);

ALTER TABLE "WhatsAppMessage"
ADD COLUMN "senderType" "WhatsAppSenderType" NOT NULL DEFAULT 'customer';

UPDATE "WhatsAppMessage"
SET "senderType" = CASE
  WHEN "direction" = 'inbound' THEN 'customer'::"WhatsAppSenderType"
  WHEN "direction" = 'outbound' AND "sentByUserId" IS NULL THEN 'bot'::"WhatsAppSenderType"
  WHEN "direction" = 'outbound' AND "sentByUserId" IS NOT NULL THEN 'agent'::"WhatsAppSenderType"
  ELSE 'system'::"WhatsAppSenderType"
END;

CREATE INDEX "WhatsAppConversation_tenantId_status_lastMessageAt_idx"
ON "WhatsAppConversation"("tenantId", "status", "lastMessageAt" DESC);

CREATE INDEX "WhatsAppConversation_tenantId_assignedToUserId_idx"
ON "WhatsAppConversation"("tenantId", "assignedToUserId");

ALTER TABLE "WhatsAppConversation"
ADD CONSTRAINT "WhatsAppConversation_assignedToUserId_fkey"
FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
