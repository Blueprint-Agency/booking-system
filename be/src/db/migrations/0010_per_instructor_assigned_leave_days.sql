-- Assigned Days move off the global policy singleton and onto the instructor.
ALTER TABLE "instructors" ADD COLUMN "annual_leave_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "medical_leave_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
-- Backfill from what the studio is running on today, NOT from the column
-- default: nobody's position may move on deploy day. `global_policy` is a
-- singleton (see its check constraint), so this cross join hits one row — and
-- on an unseeded database it hits none and the 14/14 default stands.
UPDATE "instructors" SET
  "annual_leave_days" = "global_policy"."annual_leave_days",
  "medical_leave_days" = "global_policy"."medical_leave_days"
FROM "global_policy";--> statement-breakpoint
ALTER TABLE "global_policy" DROP COLUMN "annual_leave_days";--> statement-breakpoint
ALTER TABLE "global_policy" DROP COLUMN "medical_leave_days";
