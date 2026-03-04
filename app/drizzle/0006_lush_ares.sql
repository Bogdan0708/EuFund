ALTER TABLE "audit_log"
  ADD COLUMN IF NOT EXISTS "entry_hash" varchar(64),
  ADD COLUMN IF NOT EXISTS "previous_hash" varchar(64);

CREATE INDEX IF NOT EXISTS "idx_audit_hash_chain" ON "audit_log" ("created_at", "entry_hash");
