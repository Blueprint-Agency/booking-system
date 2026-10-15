CREATE TABLE "client_billing_details" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"state" text,
	"postcode" text NOT NULL,
	"country" text DEFAULT 'SG' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_billing_details" ADD CONSTRAINT "client_billing_details_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_billing_details" ADD CONSTRAINT "client_billing_details_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_billing_details_client_id_fk_idx" ON "client_billing_details" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_billing_details_client_idx" ON "client_billing_details" USING btree ("tenant_id","client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_billing_details_one_default" ON "client_billing_details" USING btree ("tenant_id","client_id") WHERE "client_billing_details"."is_default";--> statement-breakpoint

-- Row-Level Security, written here as well as swept in by `ensureTenantIsolation`
-- on every deploy (src/db/roles.ts), as migrations 0103 and 0112 do. Same
-- predicate as migration 0033; FORCE so the owner is subject to it too.
ALTER TABLE "client_billing_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_billing_details" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "client_billing_details";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "client_billing_details"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);