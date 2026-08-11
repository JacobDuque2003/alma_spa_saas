-- User.accessSchedule — horario de acceso por cuenta (JSONB nullable).
-- Sin default: usuarios existentes tienen null → fail-open (24/7 con badge).
-- Nueva AuditAction 'accessDeniedSchedule' para registrar rechazos de horario
-- (throttled 1/día/sesión desde el middleware).

ALTER TABLE "User" ADD COLUMN "accessSchedule" JSONB;

ALTER TYPE "AuditAction" ADD VALUE 'accessDeniedSchedule';
