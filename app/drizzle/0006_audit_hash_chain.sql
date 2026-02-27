ALTER TABLE "audit_log"
  ADD COLUMN "entry_hash" varchar(64),
  ADD COLUMN "previous_hash" varchar(64);

CREATE INDEX "idx_audit_hash_chain" ON "audit_log" ("created_at", "entry_hash");
