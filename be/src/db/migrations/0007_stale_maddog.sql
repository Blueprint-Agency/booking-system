ALTER TABLE "clients" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "deleted_by_staff_id" uuid;--> statement-breakpoint
CREATE INDEX "clients_deleted_idx" ON "clients" USING btree ("deleted_at");