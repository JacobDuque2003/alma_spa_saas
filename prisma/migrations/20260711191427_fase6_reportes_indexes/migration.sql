-- CreateIndex
CREATE INDEX "Client_tenantId_createdAt_idx" ON "Client"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientLedgerEntry_tenantId_type_createdAt_idx" ON "ClientLedgerEntry"("tenantId", "type", "createdAt");
