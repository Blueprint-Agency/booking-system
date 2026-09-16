-- Two staff roles: `admin` and `instructor` (#150). After #147 and #148 an admin
-- can do everything the old superadmin role could, so every superadmin staff
-- member and invitation becomes an admin here, and the value leaves the enum.
--
-- Postgres cannot drop an enum value in place, so `staff_role` is rebuilt: the
-- columns go to text, the type is recreated, and the columns come back through a
-- cast that maps the retired value to `admin`. The mapping lives in `USING`
-- rather than in an `UPDATE` because a table rewrite is not filtered by the
-- tenant RLS policies (0033) — an `UPDATE` run by anything but a superuser would
-- skip every row and the cast would then fail on them.
--
-- Location grants go in the same change: nothing reads them since #148.
ALTER TABLE "staff_invitations" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "staff_users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."staff_role";--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'instructor');--> statement-breakpoint
ALTER TABLE "staff_invitations" ALTER COLUMN "role" SET DATA TYPE "public"."staff_role" USING (CASE WHEN "role" = 'superadmin' THEN 'admin' ELSE "role" END)::"public"."staff_role";--> statement-breakpoint
ALTER TABLE "staff_users" ALTER COLUMN "role" SET DATA TYPE "public"."staff_role" USING (CASE WHEN "role" = 'superadmin' THEN 'admin' ELSE "role" END)::"public"."staff_role";--> statement-breakpoint
DROP INDEX "staff_users_granted_locations_gin_idx";--> statement-breakpoint
ALTER TABLE "staff_invitations" DROP COLUMN "granted_location_ids";--> statement-breakpoint
ALTER TABLE "staff_users" DROP COLUMN "granted_location_ids";
