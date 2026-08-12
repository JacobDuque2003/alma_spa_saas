-- Alma Spa: cabinas reales, servicios con color/duración/buffer,
-- compatibilidad servicio-cabina, datos ampliados de cliente e indicaciones.

ALTER TABLE "Service"
  ADD COLUMN "bufferMins" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "colorHex" TEXT NOT NULL DEFAULT '#8C6E50';

ALTER TABLE "Room"
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "schedule" JSONB;

ALTER TABLE "Room"
  ALTER COLUMN "closesAt" SET DEFAULT '20:00';

ALTER TABLE "Client"
  ADD COLUMN "recordNumber" TEXT,
  ADD COLUMN "address" TEXT;

ALTER TABLE "Appointment"
  ADD COLUMN "indications" TEXT;

CREATE TABLE "_RoomServices" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "_RoomServices_AB_unique" ON "_RoomServices"("A", "B");
CREATE INDEX "_RoomServices_B_index" ON "_RoomServices"("B");

ALTER TABLE "_RoomServices"
  ADD CONSTRAINT "_RoomServices_A_fkey"
  FOREIGN KEY ("A") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_RoomServices"
  ADD CONSTRAINT "_RoomServices_B_fkey"
  FOREIGN KEY ("B") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Client_tenantId_recordNumber_key" ON "Client"("tenantId", "recordNumber");
CREATE INDEX "Room_tenantId_sortOrder_idx" ON "Room"("tenantId", "sortOrder");

-- Compatibilidad inicial para tenants existentes:
-- conecta cada servicio con cabinas cuya specialty coincide con su categoría.
INSERT INTO "_RoomServices" ("A", "B")
SELECT r."id", s."id"
FROM "Room" r
JOIN "Service" s
  ON s."tenantId" = r."tenantId"
 AND s."category" = r."specialty"
WHERE r."active" = true
  AND s."active" = true
ON CONFLICT DO NOTHING;
