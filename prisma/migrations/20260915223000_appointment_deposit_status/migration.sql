CREATE TYPE "AppointmentDepositStatus" AS ENUM ('not_required', 'pending', 'paid', 'waived');

ALTER TABLE "Appointment"
  ADD COLUMN "depositStatus" "AppointmentDepositStatus" NOT NULL DEFAULT 'not_required',
  ADD COLUMN "depositAmountUsd" DECIMAL(10,2);
