-- ============================================================================
-- Garantía append-only a nivel de base de datos para ClientIntakeAuditLog
-- ============================================================================
--
-- ESTADO ACTUAL (Fase 4): el append-only del log de auditoría de anamnesis está
-- garantizado SOLO en la capa de aplicación — ningún servicio ni ruta expone
-- UPDATE ni DELETE sobre ClientIntakeAuditLog (clientIntakeService solo hace
-- createMany + findMany). Esto es suficiente contra bugs de aplicación, pero NO
-- contra alguien con acceso directo a la base de datos.
--
-- POR QUÉ NO ESTÁ ACTIVA LA GARANTÍA DE DB TODAVÍA: la app conecta como el rol
-- `postgres`, que es SUPERUSUARIO. Un superusuario ignora todos los GRANT/REVOKE,
-- así que revocar UPDATE/DELETE sobre él no tendría ningún efecto. Para que el
-- append-only sea una garantía de la base de datos (no solo de la app), la
-- aplicación debe conectar como un rol dedicado de privilegios mínimos.
--
-- CUÁNDO APLICAR: paso de despliegue (Fase 8), a ejecutar UNA VEZ como superusuario
-- en producción, y luego cambiar DATABASE_URL para que la app use el rol `alma_app`.
-- ============================================================================

-- 1. Rol de aplicación dedicado (la app conecta como este, NO como postgres).
CREATE ROLE alma_app WITH LOGIN PASSWORD 'DEFINIR_EN_RAILWAY';
GRANT CONNECT ON DATABASE railway TO alma_app;
GRANT USAGE ON SCHEMA public TO alma_app;

-- 2. Privilegios normales sobre todas las tablas del esquema.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO alma_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO alma_app;

-- 3. La excepción append-only: sobre el log de auditoría, solo SELECT + INSERT.
--    Sin UPDATE ni DELETE — una fila de auditoría, una vez escrita, no se puede
--    alterar ni borrar desde la aplicación.
REVOKE UPDATE, DELETE ON "ClientIntakeAuditLog" FROM alma_app;
-- Que aplique también a la tabla si una migración futura la recrea:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE UPDATE, DELETE ON TABLES FROM alma_app; -- (revisar: aplicar selectivamente solo al audit log en producción)

-- NOTA: las migraciones de Prisma (prisma migrate deploy) deben seguir
-- corriéndose con un rol con DDL (el superusuario o un rol owner), NO con
-- alma_app, que solo tiene DML. Separar credenciales de migración de las de runtime.
