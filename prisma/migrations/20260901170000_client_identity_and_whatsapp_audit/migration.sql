-- Datos de identificación opcionales para completar la ficha sin forzar
-- información sensible en los contactos ya existentes.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "cedula" TEXT;

-- Trazabilidad de acciones manuales de la bandeja (resolver/no leído).
ALTER TYPE "AuditEntity" ADD VALUE IF NOT EXISTS 'whatsapp';
