ALTER TABLE "RolePermission"
  ADD COLUMN "crmEtiquetasGestionar" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "crmRespuestasRapidasGestionar" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "crmNotasGestionar" BOOLEAN NOT NULL DEFAULT false;
