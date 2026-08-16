ALTER TYPE "public"."leave_type" ADD VALUE 'study';--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "study_leave_days" integer DEFAULT 7 NOT NULL;