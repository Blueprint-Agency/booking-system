-- The sign-in audit log (#114, ticket 3 of #106). Additive only.
--
-- One row per sign-in, sign-out, failed sign-in, code sent, code failed and
-- impersonation start or end, from all three Better Auth pools. `tenant_id` is
-- nullable: a platform-pool event happened at no studio. The Row-Level Security
-- policy is not written here — `ensureTenantIsolation` adds it on deploy, and
-- gives this table the platform-row variant (`PLATFORM_ROWS`, src/db/roles.ts).
CREATE TYPE "public"."auth_event_kind" AS ENUM('sign_in', 'sign_out', 'sign_in_failed', 'code_sent', 'code_failed', 'impersonation_started', 'impersonation_ended');--> statement-breakpoint
CREATE TYPE "public"."auth_pool" AS ENUM('client', 'staff', 'platform');--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"pool" "auth_pool" NOT NULL,
	"kind" "auth_event_kind" NOT NULL,
	"actor_user_id" text,
	"subject_user_id" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_events_tenant_created_idx" ON "auth_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_events_actor_created_idx" ON "auth_events" USING btree ("actor_user_id","created_at");