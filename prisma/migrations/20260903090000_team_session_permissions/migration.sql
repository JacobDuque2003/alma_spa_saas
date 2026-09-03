-- Fine-grained configuration permissions and server-side session revocation.
ALTER TABLE "User"
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "RolePermission"
  ADD COLUMN "configuracionServicios" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "configuracionHorario" BOOLEAN NOT NULL DEFAULT false;

-- Existing accounts that could manage Configuration keep their current
-- capabilities after the permission is split into two explicit controls.
UPDATE "RolePermission"
SET
  "configuracionServicios" = "configuracion",
  "configuracionHorario" = "configuracion";

-- El módulo de movimientos ya no se ofrece en Clientes. Se elimina también
-- el permiso delegado obsoleto; el historial contable existente se conserva.
ALTER TABLE "RolePermission" DROP COLUMN IF EXISTS "clientesPagos";
