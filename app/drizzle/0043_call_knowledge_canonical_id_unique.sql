-- M1: enforce 1:1 call_knowledge ↔ calls_for_proposals after backfill dedupes.
-- If this fails with "could not create unique index", duplicates remain — re-run
-- backfill-call-knowledge-ids.ts --confirm before retrying.
DROP INDEX IF EXISTS "idx_call_knowledge_canonical";  -- replace non-unique with partial unique

CREATE UNIQUE INDEX IF NOT EXISTS "idx_call_knowledge_canonical_unique"
  ON "call_knowledge"("canonical_call_id")
  WHERE "canonical_call_id" IS NOT NULL;
