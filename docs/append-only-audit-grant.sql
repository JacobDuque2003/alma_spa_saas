-- ============================================================================
-- Least-privilege database role for Alma Spa SaaS runtime
-- ============================================================================
--
-- PURPOSE: Create a dedicated `alma_app` role with the minimum privileges
-- Prisma Client needs at runtime. The application connects as `alma_app`,
-- NOT as the `postgres` superuser. Superusers bypass all GRANT/REVOKE, so
-- privilege restrictions (like the append-only audit log) only work when the
-- app connects as a non-superuser role.
--
-- WHEN TO RUN: Once, as the `postgres` superuser on the Railway database,
-- BEFORE switching DATABASE_URL to use `alma_app`.
--
-- AFTER RUNNING: Update DATABASE_URL in Railway to use `alma_app` credentials.
-- Keep the `postgres` URL as MIGRATION_DATABASE_URL for `prisma migrate deploy`.
--
-- IDEMPOTENCY: Safe to re-run. Uses IF NOT EXISTS / OR REPLACE where possible,
-- and explicit REVOKE before GRANT to avoid privilege accumulation.
-- ============================================================================

-- ============================================================================
-- STEP 1: Create the application role
-- ============================================================================
-- The password MUST be set to a strong random value in Railway.
-- Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alma_app') THEN
    CREATE ROLE alma_app WITH LOGIN PASSWORD 'HF4d3jnGfelBTmDjrpYSwVlE0uagaWLGdKQZPhDPqH0';
    RAISE NOTICE '*** CAMBIAR LA PASSWORD INMEDIATAMENTE: ALTER ROLE alma_app WITH PASSWORD ''<password-real>''; ***';
  END IF;
END
$$;

-- ============================================================================
-- STEP 2: Database and schema access
-- ============================================================================
GRANT CONNECT ON DATABASE railway TO alma_app;
GRANT USAGE ON SCHEMA public TO alma_app;

-- Explicitly deny schema-level DDL. alma_app cannot CREATE/ALTER/DROP tables,
-- indexes, types, or functions. This is the default for non-owner roles, but
-- stating it explicitly makes the intent clear and survives accidental grants.
REVOKE CREATE ON SCHEMA public FROM alma_app;

-- ============================================================================
-- STEP 3: DML on all CURRENT tables (SELECT, INSERT, UPDATE, DELETE)
-- ============================================================================
-- This covers every table that exists at the time this script runs, including:
--   Tenant, User, RolePermission, Service, Room, Plan, Client, ClientIntake,
--   ClientIntakeAuditLog, Appointment, TreatmentHistory, ClientPlan,
--   ClientLedgerEntry, WhatsAppConnection, WhatsAppConversation,
--   WhatsAppMessage, _PlanServices, _prisma_migrations
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO alma_app;

-- ============================================================================
-- STEP 4: Default privileges for FUTURE tables
-- ============================================================================
-- When `postgres` (the role running migrations) creates new tables, alma_app
-- automatically gets full DML on them. No manual re-grant needed after each
-- migration.
--
-- IMPORTANT: This ALTER DEFAULT PRIVILEGES is scoped to tables created by the
-- `postgres` role. If a different role runs migrations, replace `postgres`
-- with that role name.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO alma_app;

-- ============================================================================
-- STEP 5: Append-only exception for ClientIntakeAuditLog
-- ============================================================================
-- The audit log for client medical intake (anamnesis) is append-only by design.
-- Once an audit row is written, it must never be modified or deleted -- not even
-- by the application. This is a database-level guarantee, not just an app-level
-- convention.
--
-- Revoke UPDATE and DELETE on this specific table. This MUST come AFTER the
-- blanket GRANT in Step 3, because PostgreSQL privilege checks are additive
-- (a REVOKE on a specific table overrides a broader GRANT for that table).
REVOKE UPDATE, DELETE ON "ClientIntakeAuditLog" FROM alma_app;

-- NOTE: We intentionally do NOT use ALTER DEFAULT PRIVILEGES to revoke
-- UPDATE/DELETE on all future tables. That would break every new table added by
-- a migration. The audit log exception is targeted to this one table only.
-- If a future migration drops and recreates ClientIntakeAuditLog, re-run
-- Step 5 (or include the REVOKE in the migration SQL).

-- ============================================================================
-- STEP 6: _prisma_migrations table -- deny runtime access
-- ============================================================================
-- Prisma Client never touches this table at runtime. Only `prisma migrate
-- deploy` (which runs as `postgres`) needs it. Revoking access reduces the
-- attack surface.
REVOKE ALL ON "_prisma_migrations" FROM alma_app;

-- ============================================================================
-- STEP 7: Sequences (not needed, but future-proofing)
-- ============================================================================
-- Currently all IDs are CUIDs generated by Prisma in JavaScript. No PostgreSQL
-- sequences exist. If a future migration adds a SERIAL/IDENTITY column, the
-- app will need USAGE on that sequence. This default privilege handles it
-- automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO alma_app;

-- Grant on any sequences that happen to already exist (currently none).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO alma_app;

-- ============================================================================
-- VERIFICATION QUERIES (run these after the script to confirm)
-- ============================================================================
-- Check alma_app's table privileges:
--   SELECT grantee, table_name, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE grantee = 'alma_app'
--   ORDER BY table_name, privilege_type;
--
-- Confirm ClientIntakeAuditLog has only SELECT + INSERT:
--   SELECT privilege_type
--   FROM information_schema.role_table_grants
--   WHERE grantee = 'alma_app' AND table_name = 'ClientIntakeAuditLog';
--   -- Expected: SELECT, INSERT (no UPDATE, no DELETE)
--
-- Confirm _prisma_migrations has no privileges:
--   SELECT privilege_type
--   FROM information_schema.role_table_grants
--   WHERE grantee = 'alma_app' AND table_name = '_prisma_migrations';
--   -- Expected: empty result
