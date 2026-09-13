-- Better Auth, alongside Clerk (#112, ticket 1 of #106). Additive only.
--
-- Three user pools, each with its own tables: `client_auth_*` (members),
-- `staff_auth_*` (studio portals) and `platform_auth_*` (the super portal).
-- None of them carries a `tenant_id`: a person who works at two studios is one
-- auth user with a `staff_users` row at each, so these are platform rows like
-- `tenants`, and `ensureTenantIsolation` must not fence them. The session's
-- Tenant claim is `claimed_tenant_id` for exactly that reason — see the note in
-- src/db/schema/auth.ts before renaming it.
--
-- `clients` and `staff_users` gain a nullable `auth_user_id` beside
-- `clerk_user_id`, unique per Tenant like its sibling. Nothing is dropped; the
-- Clerk columns go in a later migration once every row is mapped.
CREATE TABLE "client_auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"claimed_tenant_id" uuid,
	CONSTRAINT "client_auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "client_auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "client_auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "platform_auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "platform_auth_two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false,
	CONSTRAINT "platform_auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "platform_auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"claimed_tenant_id" uuid,
	CONSTRAINT "staff_auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "staff_auth_two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false,
	CONSTRAINT "staff_auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "staff_auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "auth_user_id" text;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "auth_user_id" text;--> statement-breakpoint
ALTER TABLE "client_auth_accounts" ADD CONSTRAINT "client_auth_accounts_user_id_client_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."client_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_auth_sessions" ADD CONSTRAINT "client_auth_sessions_user_id_client_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."client_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_auth_sessions" ADD CONSTRAINT "client_auth_sessions_claimed_tenant_id_tenants_id_fk" FOREIGN KEY ("claimed_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_auth_accounts" ADD CONSTRAINT "platform_auth_accounts_user_id_platform_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_auth_sessions" ADD CONSTRAINT "platform_auth_sessions_user_id_platform_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_auth_two_factors" ADD CONSTRAINT "platform_auth_two_factors_user_id_platform_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_auth_accounts" ADD CONSTRAINT "staff_auth_accounts_user_id_staff_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_auth_sessions" ADD CONSTRAINT "staff_auth_sessions_user_id_staff_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_auth_sessions" ADD CONSTRAINT "staff_auth_sessions_claimed_tenant_id_tenants_id_fk" FOREIGN KEY ("claimed_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_auth_two_factors" ADD CONSTRAINT "staff_auth_two_factors_user_id_staff_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_auth_accounts_user_idx" ON "client_auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "client_auth_sessions_user_idx" ON "client_auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "client_auth_verifications_identifier_idx" ON "client_auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "platform_auth_accounts_user_idx" ON "platform_auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_auth_sessions_user_idx" ON "platform_auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_auth_two_factors_user_idx" ON "platform_auth_two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_auth_two_factors_secret_idx" ON "platform_auth_two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "platform_auth_verifications_identifier_idx" ON "platform_auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "staff_auth_accounts_user_idx" ON "staff_auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "staff_auth_sessions_user_idx" ON "staff_auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "staff_auth_two_factors_user_idx" ON "staff_auth_two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "staff_auth_two_factors_secret_idx" ON "staff_auth_two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "staff_auth_verifications_identifier_idx" ON "staff_auth_verifications" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_auth_user_unique" UNIQUE("tenant_id","auth_user_id");--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_tenant_auth_user_unique" UNIQUE("tenant_id","auth_user_id");