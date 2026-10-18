CREATE TYPE "public"."booking_source" AS ENUM('direct', 'classpass');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "source" "booking_source" DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "classpass_reservation_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_classpass_reservation_unique" ON "bookings" USING btree ("tenant_id","classpass_reservation_id") WHERE "bookings"."classpass_reservation_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_classpass_shape" CHECK (("bookings"."source" = 'classpass') = ("bookings"."classpass_reservation_id" IS NOT NULL)
        AND ("bookings"."source" <> 'classpass' OR ("bookings"."kind" = 'class' AND "bookings"."client_package_id" IS NULL)));