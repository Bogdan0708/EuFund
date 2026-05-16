-- M1: add canonical_call_id to call_knowledge.
-- Unique index is added in 0043 AFTER backfill-call-knowledge-ids.ts dedupes;
-- it would fail here because legacy data has duplicates. Idempotent.
ALTER TABLE "call_knowledge"
  ADD COLUMN IF NOT EXISTS "canonical_call_id" uuid
  REFERENCES "calls_for_proposals"("id");

CREATE INDEX IF NOT EXISTS "idx_call_knowledge_canonical"
  ON "call_knowledge"("canonical_call_id");
