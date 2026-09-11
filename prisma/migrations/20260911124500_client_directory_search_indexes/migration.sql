CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Client_fullName_trgm_idx"
  ON "Client" USING GIN ("fullName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Client_recordNumber_trgm_idx"
  ON "Client" USING GIN ("recordNumber" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Client_whatsapp_trgm_idx"
  ON "Client" USING GIN ("whatsapp" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Client_email_trgm_idx"
  ON "Client" USING GIN ("email" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Client_cedula_trgm_idx"
  ON "Client" USING GIN ("cedula" gin_trgm_ops);
