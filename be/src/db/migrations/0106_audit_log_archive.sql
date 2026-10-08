-- The audit trails of deleted studios (docs/adr/0008-audit-rows-are-archived-not-deleted.md).
-- Deleting a studio moves its `audit_log` rows here, in the same transaction,
-- with the former studio's id, Slug and name as plain values.
CREATE TABLE "audit_log_archive" (
	"id" uuid PRIMARY KEY NOT NULL,
	"former_tenant_id" uuid NOT NULL,
	"former_tenant_slug" text NOT NULL,
	"former_tenant_name" text NOT NULL,
	"former_tenant_deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_staff_id" uuid,
	"actor_type" "audit_actor_type" NOT NULL,
	"action" text NOT NULL,
	"target_table" text NOT NULL,
	"target_id" uuid NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_archive_former_tenant_idx" ON "audit_log_archive" USING btree ("former_tenant_id","created_at");--> statement-breakpoint

-- Row-Level Security of its own. The table has no `tenant_id` (the studio is
-- `former_tenant_id`), so the Tenant isolation sweep (`ensureTenantIsolation`,
-- src/db/roles.ts) passes it by. Left at that, the app role's default DML grant
-- would let any studio's request read every deleted studio's trail. So:
--
--   - read: only outside every Tenant context, which is the super portal. A
--     studio's request always runs inside one, and sees no row.
--   - insert: only inside the context of the studio the row names. The studio
--     delete (services/tenants/delete.ts) runs in the doomed studio's context,
--     and archives that studio's rows and no other's.
--   - update, delete: no policy, so never, from any context.
--
-- FORCE so the owner is subject to it too; a superuser (migrations, seeds)
-- still bypasses it.
ALTER TABLE "audit_log_archive" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log_archive" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_read ON "audit_log_archive" FOR SELECT
  USING (nullif(current_setting('app.tenant_id', true), '') IS NULL);--> statement-breakpoint
CREATE POLICY studio_archives_its_own ON "audit_log_archive" FOR INSERT
  WITH CHECK (former_tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
