CREATE TYPE "public"."credit_movement_actor" AS ENUM('member', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."credit_movement_cause" AS ENUM('opening', 'booked', 'returned', 'kept', 'no_show', 'expired', 'adjusted', 'pt_requested', 'pt_returned');--> statement-breakpoint
CREATE TABLE "credit_movements" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"client_package_id" uuid NOT NULL,
	"booking_id" uuid,
	"cause" "credit_movement_cause" NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer,
	"actor" "credit_movement_actor" NOT NULL,
	"acted_by_staff_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pt_requests" ADD COLUMN "cancel_source" "cancellation_source";--> statement-breakpoint
ALTER TABLE "credit_movements" ADD CONSTRAINT "credit_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_movements" ADD CONSTRAINT "credit_movements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_movements" ADD CONSTRAINT "credit_movements_client_package_id_client_packages_id_fk" FOREIGN KEY ("client_package_id") REFERENCES "public"."client_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_movements" ADD CONSTRAINT "credit_movements_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_movements" ADD CONSTRAINT "credit_movements_acted_by_staff_id_staff_users_id_fk" FOREIGN KEY ("acted_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_movements_client_id_fk_idx" ON "credit_movements" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "credit_movements_client_package_id_fk_idx" ON "credit_movements" USING btree ("client_package_id");--> statement-breakpoint
CREATE INDEX "credit_movements_booking_id_fk_idx" ON "credit_movements" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "credit_movements_acted_by_staff_id_fk_idx" ON "credit_movements" USING btree ("acted_by_staff_id");--> statement-breakpoint
CREATE INDEX "credit_movements_package_created_idx" ON "credit_movements" USING btree ("tenant_id","client_package_id","created_at");--> statement-breakpoint

-- Where each package's history starts (#353). Movements before this migration
-- are not invented: every package a member holds gets one `opening` row with
-- the balance it has now, stamped now, and its Credit history reads
-- "History from <that date>". A package bought later needs none — its history
-- starts at its purchase. A package whose member was deleted has nobody to
-- read it, so it is left out.
INSERT INTO credit_movements (tenant_id, client_id, client_package_id, cause, delta, balance_after, actor)
SELECT tenant_id, client_id, id, 'opening', 0, credits_or_sessions_remaining, 'system'
FROM client_packages
WHERE client_id IS NOT NULL;--> statement-breakpoint

-- Row-Level Security, written here as well as swept in by `ensureTenantIsolation`
-- on every deploy (src/db/roles.ts), as migration 0094 does. Same predicate as
-- migration 0033; FORCE so the owner is subject to it too.
ALTER TABLE "credit_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "credit_movements";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "credit_movements"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);