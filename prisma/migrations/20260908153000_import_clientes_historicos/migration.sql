-- Las fichas históricas pueden existir sin celular/WhatsApp. PostgreSQL
-- permite varios NULL aun con el índice único tenantId + whatsapp.
ALTER TABLE "Client" ALTER COLUMN "whatsapp" DROP NOT NULL;

-- Un cumpleaños histórico que viene como día/mes se guarda con 2026 solo
-- como ancla de calendario. Este flag impide mostrar ese año o una edad falsa.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "birthdayYearKnown" BOOLEAN NOT NULL DEFAULT true;
