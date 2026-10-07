-- Who cancelled, truthfully (#350): `system` for a cancel the studio's machinery
-- made (a Refund's Void, a Complimentary Package's Remove, a Package rule
-- change), and the staff member behind an admin or instructor cancel. Rows
-- already written are left as they are: no source is guessed, no staff id filled.
ALTER TYPE "public"."cancellation_source" ADD VALUE 'system';--> statement-breakpoint
ALTER TABLE "cancellations" ADD COLUMN "cancelled_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_cancelled_by_staff_id_staff_users_id_fk" FOREIGN KEY ("cancelled_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cancellations_cancelled_by_staff_id_fk_idx" ON "cancellations" USING btree ("cancelled_by_staff_id");
