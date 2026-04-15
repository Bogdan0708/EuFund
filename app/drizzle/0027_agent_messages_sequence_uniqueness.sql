-- Precondition check: fail loudly if duplicates exist. Operator must
-- resolve (see runbook) before this migration applies.
DO $$
DECLARE
  dup_count bigint;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT session_id, sequence_number
    FROM agent_messages
    GROUP BY session_id, sequence_number
    HAVING count(*) > 1
  ) dups;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'agent_messages has % duplicate (session_id, sequence_number) groups — reconcile before migrating', dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_messages_session_sequence"
  ON "agent_messages" ("session_id", "sequence_number");

DROP INDEX IF EXISTS "idx_agent_messages_seq";
