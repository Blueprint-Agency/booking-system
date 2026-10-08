ALTER TABLE "classes" ADD COLUMN "checkin_nag_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pt_sessions" ADD COLUMN "checkin_nag_sent_at" timestamp with time zone;