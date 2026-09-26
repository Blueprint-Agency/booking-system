-- Leave belongs to a staff member, not an instructor profile (#315,
-- be/docs/adr/0009). The contract step of what 0089 and 0090 began.
--
-- `leave_requests` and `leave_pools` are re-pointed from `instructors` to
-- `staff_users`. No value changes: an instructor's primary key IS its staff
-- user id, so every existing row already names the right staff row. Only the
-- foreign keys and the names move — the column, its indexes, the Pool's
-- primary key. Renamed, not dropped and re-added, so no row is rewritten.
--
-- The Assigned Days on `instructors` go last, once 0090 has copied them.
--
-- **The revision before this one reads the old names**, and the deploy
-- migrates before it swaps containers, so between this migration and the swap
-- the outgoing image's leave pages and staff list query columns that no longer
-- exist and fail until the new image is serving. Rolling back past it needs a
-- migration of its own. Written as one custom file because drizzle-kit can
-- only ask "rename or drop and add?" on a terminal; the snapshot beside it was
-- produced from the schema by drizzle-kit's `generateDrizzleJson`, and
-- `npm run db:generate` reports nothing to migrate against it.
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_instructor_id_instructors_staff_user_id_fk";--> statement-breakpoint
ALTER TABLE "leave_pools" DROP CONSTRAINT "leave_pools_instructor_id_instructors_staff_user_id_fk";--> statement-breakpoint
ALTER TABLE "leave_requests" RENAME COLUMN "instructor_id" TO "staff_user_id";--> statement-breakpoint
ALTER TABLE "leave_pools" RENAME COLUMN "instructor_id" TO "staff_user_id";--> statement-breakpoint
ALTER INDEX "leave_requests_instructor_id_fk_idx" RENAME TO "leave_requests_staff_user_id_fk_idx";--> statement-breakpoint
ALTER INDEX "leave_requests_instructor_year_idx" RENAME TO "leave_requests_staff_user_year_idx";--> statement-breakpoint
ALTER TABLE "leave_pools" RENAME CONSTRAINT "leave_pools_instructor_id_type_leave_year_pk" TO "leave_pools_staff_user_id_type_leave_year_pk";--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_pools" ADD CONSTRAINT "leave_pools_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructors" DROP COLUMN "annual_leave_days";--> statement-breakpoint
ALTER TABLE "instructors" DROP COLUMN "medical_leave_days";--> statement-breakpoint
ALTER TABLE "instructors" DROP COLUMN "study_leave_days";
