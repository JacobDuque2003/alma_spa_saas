-- Servicios principales y subservicios. Los hijos se mantienen como
-- servicios reservables, pero heredan la clasificación visual y operativa del
-- servicio principal desde la aplicación.
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "parentServiceId" TEXT;

CREATE INDEX IF NOT EXISTS "Service_tenantId_parentServiceId_active_idx"
  ON "Service"("tenantId", "parentServiceId", "active");

ALTER TABLE "Service"
  ADD CONSTRAINT "Service_parentServiceId_fkey"
  FOREIGN KEY ("parentServiceId") REFERENCES "Service"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Mejora la lectura del directorio de clientas activo sin depender de una
-- caché externa para la consulta más frecuente.
CREATE INDEX IF NOT EXISTS "Client_tenantId_active_fullName_idx"
  ON "Client"("tenantId", "active", "fullName");

-- Normalizamos los dos servicios principales que ya existían en el catálogo.
UPDATE "Service"
SET "name" = 'Masajes relajantes'
WHERE LOWER(BTRIM("name")) IN ('masaje relajante', 'masajes relajantes')
  AND "parentServiceId" IS NULL;

UPDATE "Service"
SET "name" = 'Tratamientos faciales'
WHERE LOWER(BTRIM("name")) = 'tratamientos faciales'
  AND "parentServiceId" IS NULL;

-- Crea cada subservicio una sola vez por tenant y conserva los datos de
-- disponibilidad del servicio principal (categoría, cabinas, color y pausa).
WITH parent AS (
  SELECT * FROM "Service"
  WHERE LOWER(BTRIM("name")) = 'masajes relajantes' AND "parentServiceId" IS NULL
), desired(name) AS (
  VALUES
    ('Masaje descontracturante'), ('Masaje con piedras calientes'),
    ('Masaje con ventosas'), ('Masaje con bambú'), ('Masaje terapéutico'),
    ('Masaje deportivo'), ('Drenaje linfático')
)
INSERT INTO "Service" (
  "id", "tenantId", "name", "category", "parentServiceId", "durationMins",
  "bufferMins", "colorHex", "priceUsd", "offersHomeService", "active",
  "description", "createdAt", "updatedAt"
)
SELECT
  'sub_' || md5(parent."id" || desired.name || clock_timestamp()::text),
  parent."tenantId", desired.name, parent."category", parent."id",
  parent."durationMins", parent."bufferMins", parent."colorHex", parent."priceUsd",
  false, parent."active", NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM parent CROSS JOIN desired
WHERE NOT EXISTS (
  SELECT 1 FROM "Service" existing
  WHERE existing."tenantId" = parent."tenantId"
    AND existing."parentServiceId" = parent."id"
    AND LOWER(existing."name") = LOWER(desired.name)
);

WITH parent AS (
  SELECT * FROM "Service"
  WHERE LOWER(BTRIM("name")) = 'tratamientos faciales' AND "parentServiceId" IS NULL
), desired(name) AS (
  VALUES
    ('Tratamiento Hollywood Peel'), ('Láser anti-age'), ('Masoterapia facial'),
    ('Tratamiento para acné'), ('Tratamiento para manchas')
)
INSERT INTO "Service" (
  "id", "tenantId", "name", "category", "parentServiceId", "durationMins",
  "bufferMins", "colorHex", "priceUsd", "offersHomeService", "active",
  "description", "createdAt", "updatedAt"
)
SELECT
  'sub_' || md5(parent."id" || desired.name || clock_timestamp()::text),
  parent."tenantId", desired.name, parent."category", parent."id",
  parent."durationMins", parent."bufferMins", parent."colorHex", parent."priceUsd",
  false, parent."active", NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM parent CROSS JOIN desired
WHERE NOT EXISTS (
  SELECT 1 FROM "Service" existing
  WHERE existing."tenantId" = parent."tenantId"
    AND existing."parentServiceId" = parent."id"
    AND LOWER(existing."name") = LOWER(desired.name)
);

-- Las cabinas compatibles de cada padre se conectan con sus hijos. Es seguro
-- volver a correr esta sección porque la tabla puente rechaza duplicados.
INSERT INTO "_RoomServices" ("A", "B")
SELECT links."A", child."id"
FROM "Service" child
JOIN "Service" parent ON parent."id" = child."parentServiceId"
JOIN "_RoomServices" links ON links."B" = parent."id"
ON CONFLICT DO NOTHING;

-- Completa las fichas históricas ausentes usando el número positivo libre más
-- pequeño para cada tenant. Las fichas existentes nunca se modifican.
WITH missing AS (
  SELECT "id", "tenantId",
    ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", "id") AS position
  FROM "Client"
  WHERE "recordNumber" IS NULL OR BTRIM("recordNumber") = ''
), totals AS (
  SELECT "tenantId", COUNT(*)::INTEGER AS missing_count
  FROM missing GROUP BY "tenantId"
), used AS (
  SELECT "tenantId", "recordNumber"::INTEGER AS number
  FROM "Client"
  WHERE "recordNumber" ~ '^[1-9][0-9]{0,8}$'
), available AS (
  SELECT totals."tenantId", generated.number,
    ROW_NUMBER() OVER (PARTITION BY totals."tenantId" ORDER BY generated.number) AS position
  FROM totals
  CROSS JOIN LATERAL generate_series(1, totals.missing_count + (
    SELECT COUNT(*)::INTEGER FROM used WHERE used."tenantId" = totals."tenantId"
  ) + 1) AS generated(number)
  WHERE NOT EXISTS (
    SELECT 1 FROM used
    WHERE used."tenantId" = totals."tenantId" AND used.number = generated.number
  )
)
UPDATE "Client" client
SET "recordNumber" = available.number::TEXT
FROM missing
JOIN available ON available."tenantId" = missing."tenantId" AND available.position = missing.position
WHERE client."id" = missing."id";
