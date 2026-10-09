CREATE TABLE "receipt_counters" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"client_id" uuid,
	"number" integer NOT NULL,
	"display_number" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seller_name" text NOT NULL,
	"seller_legal_name" text,
	"seller_registration_number" text,
	"seller_address" text,
	"seller_footer" text,
	"buyer_name" text,
	"buyer_email" text,
	"kind" "purchase_kind" NOT NULL,
	"lines" jsonb NOT NULL,
	"subtotal_sgd" numeric(10, 2) NOT NULL,
	"discount_sgd" numeric(10, 2) NOT NULL,
	"total_sgd" numeric(10, 2) NOT NULL,
	"payments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refunded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "receipt_counters" ADD CONSTRAINT "receipt_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_purchase_id_fk_idx" ON "receipts" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "receipts_client_id_fk_idx" ON "receipts" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_purchase_unique" ON "receipts" USING btree ("tenant_id","purchase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_number_unique" ON "receipts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_display_number_unique" ON "receipts" USING btree ("tenant_id","display_number");--> statement-breakpoint
CREATE INDEX "receipts_client_issued_idx" ON "receipts" USING btree ("tenant_id","client_id","issued_at");--> statement-breakpoint

-- Row-Level Security, written here as well as swept in by `ensureTenantIsolation`
-- on every deploy (src/db/roles.ts), as migration 0103 does. Same predicate as
-- migration 0033; FORCE so the owner is subject to it too.
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "receipts";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "receipts"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "receipt_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipt_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "receipt_counters";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "receipt_counters"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);