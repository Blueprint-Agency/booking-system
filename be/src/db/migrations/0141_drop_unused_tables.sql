-- Three tables nothing reads or writes are dropped: the admin Inbox (#237) and
-- waivers (#233) are not being built. `inbox_items` takes its enum with it. Their
-- rows are not archived anywhere else; the pre-migrate snapshot every deploy takes
-- (docs/md/deployment.md) is the way back.
--
-- This is the contract step (src/db/migrations/README.md rule 0): the previous
-- deploy stopped reading these tables, so no running build or rollback target
-- names them. No CASCADE: nothing depends on them, and if something does the
-- migration should stop rather than take it along.
DROP TABLE "waiver";--> statement-breakpoint
DROP TABLE "waiver_signatures";--> statement-breakpoint
DROP TABLE "inbox_items";--> statement-breakpoint
DROP TYPE "public"."inbox_item_type";
