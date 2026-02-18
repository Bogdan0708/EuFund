CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_subscription_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_status" varchar(50) DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "api_calls_this_month" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_password_reset_tokens_user" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_password_reset_tokens_token" ON "password_reset_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_users_stripe_customer" ON "users" USING btree ("stripe_customer_id");