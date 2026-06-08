ALTER TABLE "corporate_sessions" ALTER COLUMN "location_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ALTER COLUMN "room_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD COLUMN "location_text" text;