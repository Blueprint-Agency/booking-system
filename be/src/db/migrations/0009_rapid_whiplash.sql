CREATE TYPE "public"."leave_half_day" AS ENUM('none', 'morning', 'afternoon');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn', 'cancelled', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('annual', 'medical');--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"type" "leave_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"half_day" "leave_half_day" DEFAULT 'none' NOT NULL,
	"days" numeric(4, 1) NOT NULL,
	"leave_year" integer NOT NULL,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"decision_reason" text,
	"decided_by_staff_id" uuid,
	"decided_at" timestamp with time zone,
	"medical_cert_r2_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "global_policy" ADD COLUMN "annual_leave_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_policy" ADD COLUMN "medical_leave_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_staff_id_staff_users_id_fk" FOREIGN KEY ("decided_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_requests_instructor_year_idx" ON "leave_requests" USING btree ("instructor_id","leave_year");--> statement-breakpoint
CREATE INDEX "leave_requests_dates_idx" ON "leave_requests" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "leave_requests_status_idx" ON "leave_requests" USING btree ("status");