CREATE TABLE "feature_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" varchar(100) UNIQUE NOT NULL,
  "description" text,
  "enabled" boolean NOT NULL DEFAULT false,
  "targeting" jsonb DEFAULT '{}'::jsonb,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
