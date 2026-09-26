ALTER TABLE "staff_users" ADD COLUMN "annual_leave_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "medical_leave_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "study_leave_days" integer DEFAULT 7 NOT NULL;