ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "outsideBusinessHours" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "outsideBusinessHoursReason" TEXT,
  ADD COLUMN IF NOT EXISTS "outsideBusinessHoursById" TEXT;
