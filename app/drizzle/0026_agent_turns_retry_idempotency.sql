CREATE TABLE IF NOT EXISTS "agent_turns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "request_id" text NOT NULL,
  "runtime_mode" "runtime_mode" NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "agent_turns_session_request_unique" UNIQUE("session_id","request_id")
);

DO $$ BEGIN
  ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "idx_agent_turns_session_started"
  ON "agent_turns" ("session_id", "started_at" DESC);

ALTER TABLE "agent_messages"
  ADD COLUMN IF NOT EXISTS "turn_id" uuid;

DO $$ BEGIN
  ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_turn_id_fkey"
    FOREIGN KEY ("turn_id") REFERENCES "agent_turns"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
