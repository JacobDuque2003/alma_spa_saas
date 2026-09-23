-- Algunas cabinas son equipos autónomos y no deben bloquear a una terapeuta.
ALTER TABLE "Room" ADD COLUMN "requiresStaff" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Appointment" ALTER COLUMN "staffId" DROP NOT NULL;

-- La cabina de pies de Alma Spa funciona como máquina.
UPDATE "Room"
SET "requiresStaff" = false
WHERE UPPER("name") LIKE '%PIES%';
