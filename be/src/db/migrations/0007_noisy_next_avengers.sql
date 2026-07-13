CREATE TABLE "manual_payroll_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"amount_sgd" numeric(10, 2) NOT NULL,
	"label" text NOT NULL,
	"entry_date" timestamp with time zone NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manual_payroll_entries" ADD CONSTRAINT "manual_payroll_entries_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_payroll_entries" ADD CONSTRAINT "manual_payroll_entries_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_payroll_entries_instructor_entry_date_idx" ON "manual_payroll_entries" USING btree ("instructor_id","entry_date");