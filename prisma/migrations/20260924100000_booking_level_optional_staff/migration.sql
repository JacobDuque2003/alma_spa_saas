-- La necesidad de terapeuta se decide por reserva, no por cabina.
UPDATE "Room" SET "requiresStaff" = true WHERE "requiresStaff" = false;
