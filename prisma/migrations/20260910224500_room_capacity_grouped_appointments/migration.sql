ALTER TABLE "Room"
  ADD COLUMN IF NOT EXISTS "capacity" INTEGER NOT NULL DEFAULT 1;

UPDATE "Room"
SET "capacity" = CASE
  WHEN "sortOrder" IN (4, 5) THEN 2
  WHEN "sortOrder" = 6 THEN 4
  ELSE GREATEST("capacity", 1)
END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Room_capacity_check'
  ) THEN
    ALTER TABLE "Room"
      ADD CONSTRAINT "Room_capacity_check" CHECK ("capacity" BETWEEN 1 AND 12);
  END IF;
END $$;

DROP INDEX IF EXISTS "Appointment_roomId_startsAt_key";

CREATE INDEX IF NOT EXISTS "Appointment_roomId_startsAt_idx"
  ON "Appointment"("roomId", "startsAt");
