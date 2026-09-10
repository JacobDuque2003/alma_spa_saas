ALTER TABLE "RolePermission"
ADD COLUMN "agendaCrearMover" BOOLEAN NOT NULL DEFAULT false;

UPDATE "RolePermission"
SET "agendaCrearMover" = true
WHERE "agenda" = true;
