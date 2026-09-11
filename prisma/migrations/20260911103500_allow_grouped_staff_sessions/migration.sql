DROP INDEX IF EXISTS "Appointment_staffId_startsAt_key";

CREATE INDEX IF NOT EXISTS "Appointment_staffId_startsAt_idx" ON "Appointment"("staffId", "startsAt");
