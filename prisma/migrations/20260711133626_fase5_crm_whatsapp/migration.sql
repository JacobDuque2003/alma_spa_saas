-- CreateEnum
CREATE TYPE "WhatsAppConnStatus" AS ENUM ('activo', 'desconectado', 'error');

-- CreateEnum
CREATE TYPE "WhatsAppDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "WhatsAppMessageType" AS ENUM ('text', 'template', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'interactive', 'other');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('received', 'queued', 'sent', 'delivered', 'read', 'failed');

-- CreateTable
CREATE TABLE "WhatsAppConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "displayPhone" TEXT,
    "accessTokenEnc" BYTEA NOT NULL,
    "accessTokenIv" BYTEA NOT NULL,
    "accessTokenTag" BYTEA NOT NULL,
    "appSecretEnc" BYTEA NOT NULL,
    "appSecretIv" BYTEA NOT NULL,
    "appSecretTag" BYTEA NOT NULL,
    "verifyTokenHash" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "WhatsAppConnStatus" NOT NULL DEFAULT 'activo',
    "lastError" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT,
    "customerWaId" TEXT NOT NULL,
    "customerName" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastReadAt" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "WhatsAppDirection" NOT NULL,
    "type" "WhatsAppMessageType" NOT NULL DEFAULT 'text',
    "status" "WhatsAppMessageStatus" NOT NULL,
    "waMessageId" TEXT,
    "body" TEXT,
    "templateName" TEXT,
    "templateLang" TEXT,
    "mediaId" TEXT,
    "errorCode" TEXT,
    "errorTitle" TEXT,
    "sentByUserId" TEXT,
    "waTimestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_tenantId_key" ON "WhatsAppConnection"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_phoneNumberId_key" ON "WhatsAppConnection"("phoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_verifyTokenHash_key" ON "WhatsAppConnection"("verifyTokenHash");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_tenantId_lastMessageAt_idx" ON "WhatsAppConversation"("tenantId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "WhatsAppConversation_tenantId_clientId_idx" ON "WhatsAppConversation"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_tenantId_customerWaId_key" ON "WhatsAppConversation"("tenantId", "customerWaId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_waMessageId_key" ON "WhatsAppMessage"("waMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_tenantId_conversationId_createdAt_idx" ON "WhatsAppMessage"("tenantId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_status_startsAt_idx" ON "Appointment"("tenantId", "status", "startsAt");

-- AddForeignKey
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
