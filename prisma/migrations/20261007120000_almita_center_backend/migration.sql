-- CreateTable
CREATE TABLE "AlmitaConfiguration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personality" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "dailyBriefing" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AlmitaConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlmitaKnowledge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AlmitaKnowledge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlmitaApprovedExample" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userMessage" TEXT NOT NULL,
    "expectedIntent" TEXT NOT NULL,
    "expectedReply" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AlmitaApprovedExample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlmitaConfiguration_tenantId_version_key" ON "AlmitaConfiguration"("tenantId", "version");
CREATE INDEX "AlmitaConfiguration_tenantId_active_version_idx" ON "AlmitaConfiguration"("tenantId", "active", "version" DESC);
CREATE UNIQUE INDEX "AlmitaConfiguration_one_active_per_tenant_idx" ON "AlmitaConfiguration"("tenantId") WHERE "active" = true;
CREATE INDEX "AlmitaKnowledge_tenantId_active_priority_idx" ON "AlmitaKnowledge"("tenantId", "active", "priority" DESC);
CREATE INDEX "AlmitaKnowledge_tenantId_category_active_idx" ON "AlmitaKnowledge"("tenantId", "category", "active");
CREATE INDEX "AlmitaApprovedExample_tenantId_active_updatedAt_idx" ON "AlmitaApprovedExample"("tenantId", "active", "updatedAt" DESC);
CREATE INDEX "AlmitaApprovedExample_tenantId_expectedIntent_active_idx" ON "AlmitaApprovedExample"("tenantId", "expectedIntent", "active");

ALTER TABLE "AlmitaConfiguration" ADD CONSTRAINT "AlmitaConfiguration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlmitaKnowledge" ADD CONSTRAINT "AlmitaKnowledge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlmitaApprovedExample" ADD CONSTRAINT "AlmitaApprovedExample_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Initial editorial configuration for the Alma Spa pilot. Prices and durations
-- continue to come from Service, which remains the operational source of truth.
INSERT INTO "AlmitaConfiguration" ("id", "tenantId", "personality", "instructions", "dailyBriefing", "active", "version", "createdById", "createdAt", "updatedAt")
SELECT
  'almita_config_initial',
  t."id",
  'Cálida, breve, serena y profesional. Habla como una asesora atenta, sin sonar robótica ni exageradamente espiritual.',
  'Primero resuelve la intención de la clienta. Para reservar, informa brevemente sobre el servicio y luego solicita únicamente el dato que falta. Usa precios y duraciones solo desde el catálogo operativo. No diagnostiques ni prometas resultados médicos. Cuando la solicitud requiera criterio humano, ofrece contactar a un asesor.',
  'Antes de responder, revisa avisos temporales y cambios vigentes. Si no existe un aviso activo, conserva el flujo normal y no inventes promociones ni disponibilidad.',
  true,
  1,
  'system',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Tenant" t
WHERE t."slug" = 'alma-spa'
  AND NOT EXISTS (SELECT 1 FROM "AlmitaConfiguration" c WHERE c."tenantId" = t."id" AND c."active" = true);

INSERT INTO "AlmitaKnowledge" ("id", "tenantId", "category", "title", "content", "active", "priority", "source", "createdAt", "updatedAt")
SELECT v."id", t."id", v."category", v."title", v."content", true, v."priority", 'Catálogo AlmaSpa.pdf (revisión editorial)', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (VALUES
  ('almita_k_facial_kids', 'Faciales', 'Limpieza facial kids', 'Experiencia de cuidado facial pensada para público infantil. Antes de reservar, confirmar edad y cualquier sensibilidad conocida con un asesor.', 70),
  ('almita_k_facial_profunda', 'Faciales', 'Limpieza facial profunda', 'Servicio de limpieza facial profunda orientado al cuidado y bienestar de la piel. Evitar prometer resultados clínicos; si hay una condición de piel, recomendar valoración profesional.', 70),
  ('almita_k_labios', 'Faciales', 'Hidratación de labios', 'Servicio de bienestar estético enfocado en hidratar y cuidar la apariencia de los labios.', 60),
  ('almita_k_laser', 'Estética', 'Láser diodo', 'Servicio de depilación con láser diodo. La zona, preparación, contraindicaciones y número de sesiones deben confirmarse con un asesor antes de reservar.', 80),
  ('almita_k_masajes', 'Masajes', 'Masajes de bienestar', 'El catálogo incluye masaje relajante, masaje con piedras calientes y masaje con bambú. Presentarlos como experiencias de bienestar; ante dolor intenso, nuevo o persistente, sugerir consultar a un profesional de salud.', 80),
  ('almita_k_capilar', 'Capilar', 'Tratamientos capilares', 'Tratamientos orientados al cuidado y bienestar capilar. El tipo adecuado se confirma según la necesidad de la clienta.', 60),
  ('almita_k_terapia_neural', 'Terapias', 'Terapia neural', 'Servicio que requiere orientación previa del equipo. Almita no diagnostica, no indica medicamentos y debe derivar preguntas clínicas a un profesional.', 90),
  ('almita_k_sonido', 'Terapias', 'Terapia de sonido', 'Experiencia de relajación y bienestar mediante sonido. No sustituye atención médica o psicológica.', 70),
  ('almita_k_paquetes', 'Paquetes', 'Paquetes del catálogo', 'El catálogo presenta Paquete détox y reducción consciente, Paquete détox facial y Paquete alivio profundo. La composición, vigencia y precio deben confirmarse con el catálogo operativo o un asesor antes de ofrecerlos.', 85),
  ('almita_k_reservas', 'Atención', 'Orden del flujo de reserva', 'Cuando una clienta quiera reservar: identificar el servicio, dar información breve y el precio vigente, preguntar fecha, mostrar disponibilidad real, pedir la hora y confirmar los datos necesarios. No solicitar cédula ni dirección antes de completar la selección de la cita.', 100)
) AS v("id", "category", "title", "content", "priority")
WHERE t."slug" = 'alma-spa';
