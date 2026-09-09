-- Horarios configurables por servicio/subservicio para la agenda.
-- null mantiene el comportamiento anterior: el servicio sigue el horario del
-- tenant o, si es subservicio, el horario efectivo del servicio principal.
ALTER TABLE "Service"
  ADD COLUMN IF NOT EXISTS "appointmentSchedule" JSONB;
