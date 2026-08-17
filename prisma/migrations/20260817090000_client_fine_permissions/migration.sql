ALTER TABLE "RolePermission"
  ADD COLUMN "clientesEditar" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clientesAnamnesis" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clientesHistorial" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clientesEstado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clientesEliminar" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clientesPagos" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clientesExportar" BOOLEAN NOT NULL DEFAULT false;
