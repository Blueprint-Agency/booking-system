-- The platform's own settings (docs/adr/0007-platform-settings.md): one row that
-- belongs to no studio, holding Maintenance mode. `id` is always true, so there
-- is at most one row; no row reads as "off, in the platform's default words".
CREATE TABLE "platform_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"maintenance_enabled" boolean DEFAULT false NOT NULL,
	"maintenance_message" text,
	"maintenance_updated_by" text,
	"maintenance_updated_at" timestamp with time zone,
	CONSTRAINT "platform_settings_single_row" CHECK ("platform_settings"."id")
);--> statement-breakpoint

-- Row-Level Security of its own. The table has no `tenant_id`, so the Tenant
-- isolation sweep (`ensureTenantIsolation`, src/db/roles.ts) passes it by, as it
-- passes `tenants` and the platform pool's auth tables. Left at that, the app
-- role's default DML grant would let code running inside a studio's context
-- switch the whole platform off. So, two permissive policies:
--
--   - read: from every context. The maintenance gate reads the switch on
--     tenant-facing requests; it holds nothing about any studio, so reading it
--     from inside one leaks nothing.
--   - write: only outside every Tenant context — the same "no Tenant is the
--     platform's" reading `PLATFORM_ROWS` gives `auth_events`. The super portal
--     runs outside one (it is exempt from `resolveTenant`); a studio's request
--     never does. Inside a context an UPDATE matches no row and an INSERT is
--     refused.
--
-- FORCE so the owner is subject to it too; a superuser (migrations, seeds)
-- still bypasses it.
ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_read ON "platform_settings" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY platform_write ON "platform_settings" FOR ALL
  USING (nullif(current_setting('app.tenant_id', true), '') IS NULL)
  WITH CHECK (nullif(current_setting('app.tenant_id', true), '') IS NULL);
