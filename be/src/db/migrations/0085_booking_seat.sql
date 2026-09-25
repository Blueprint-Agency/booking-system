CREATE TYPE "public"."booking_seat" AS ENUM('online', 'buffer', 'overbook');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "seat" "booking_seat" DEFAULT 'online' NOT NULL;