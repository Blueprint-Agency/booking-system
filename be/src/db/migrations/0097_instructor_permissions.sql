-- Instructor Permissions (#328, be/docs/adr/0012): three per-instructor switches
-- an Admin sets. The default backfills every current instructors row with all
-- three, so nothing changes at deploy, and an archive taken before this column
-- takes the same default on import.
CREATE TYPE "public"."instructor_permission" AS ENUM('schedule_classes', 'take_pt_bookings', 'manage_rosters');--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "permissions" "instructor_permission"[] DEFAULT '{schedule_classes,take_pt_bookings,manage_rosters}'::instructor_permission[] NOT NULL;