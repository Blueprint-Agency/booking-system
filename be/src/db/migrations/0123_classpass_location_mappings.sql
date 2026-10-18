CREATE TABLE "classpass_location_mappings" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_name" text NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classpass_location_mappings" ADD CONSTRAINT "classpass_location_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classpass_location_mappings" ADD CONSTRAINT "classpass_location_mappings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classpass_location_mappings_name_unique" ON "classpass_location_mappings" USING btree ("tenant_id","location_name");--> statement-breakpoint
CREATE INDEX "classpass_location_mappings_location_id_fk_idx" ON "classpass_location_mappings" USING btree ("location_id");--> statement-breakpoint
-- Row-Level Security, written here as well as swept in by `ensureTenantIsolation`
-- on every deploy (src/db/roles.ts), as migrations 0103, 0112, 0116 and 0122 do.
-- Same predicate as migration 0033; FORCE so the owner is subject to it too.
ALTER TABLE "classpass_location_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "classpass_location_mappings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "classpass_location_mappings";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "classpass_location_mappings"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);