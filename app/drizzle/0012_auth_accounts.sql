-- Auth accounts (OAuth provider linking for NextAuth)
CREATE TABLE IF NOT EXISTS "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"type" varchar(50) NOT NULL,
	"provider" varchar(50) NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" varchar(50),
	"scope" text,
	"id_token" text,
	"session_state" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_auth_accounts_provider" ON "auth_accounts" USING btree ("provider","provider_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_accounts_user" ON "auth_accounts" USING btree ("user_id");

-- Auth verification tokens (magic link tokens for NextAuth Email provider)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_verification_tokens" (
	"identifier" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_auth_verification_tokens_compound" ON "auth_verification_tokens" USING btree ("identifier","token");
