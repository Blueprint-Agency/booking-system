CREATE TYPE "public"."waitlist_status" AS ENUM('waiting', 'promoted', 'withdrawn', 'removed', 'expired');--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"status" "waitlist_status" DEFAULT 'waiting' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"booking_id" uuid,
	"resolved_by" text,
	CONSTRAINT "waitlist_entries_promoted_booking" CHECK (("waitlist_entries"."status" = 'promoted') = ("waitlist_entries"."booking_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waitlist_entries_booking_id_fk_idx" ON "waitlist_entries" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "waitlist_entries_class_id_fk_idx" ON "waitlist_entries" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "waitlist_entries_client_id_fk_idx" ON "waitlist_entries" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "waitlist_entries_class_line_idx" ON "waitlist_entries" USING btree ("tenant_id","class_id","status","joined_at");--> statement-breakpoint
CREATE INDEX "waitlist_entries_client_idx" ON "waitlist_entries" USING btree ("tenant_id","client_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_one_waiting_unique" ON "waitlist_entries" USING btree ("tenant_id","class_id","client_id") WHERE "waitlist_entries"."status" = 'waiting';--> statement-breakpoint

-- Row-Level Security, written here as well as swept in by `ensureTenantIsolation`
-- on every deploy (src/db/roles.ts): the sweep is what guarantees it, this is
-- what makes a database that has only had `db:migrate` run against it correct
-- from the moment the table exists. Same predicate as migration 0033 (and
-- 0073); FORCE so the owner is subject to it too.
ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "waitlist_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "waitlist_entries";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "waitlist_entries"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);