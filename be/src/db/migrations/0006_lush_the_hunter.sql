ALTER TABLE "staff_users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "class_types" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "class_packages" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corporate_packages" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pt_packages" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "staff_users_deleted_idx" ON "staff_users" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "class_types_deleted_idx" ON "class_types" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "locations_deleted_idx" ON "locations" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "rooms_deleted_idx" ON "rooms" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "class_packages_deleted_idx" ON "class_packages" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "corporate_packages_deleted_idx" ON "corporate_packages" USING btree ("deleted_at");