-- Policy stops being a *platform* singleton and becomes one **per tenant**.
--
-- `global_policy` and `pt_booking_config` each carried a
-- `CHECK (id = '<fixed uuid>')`, which is the correct constraint for one studio
-- and a data leak for two: no second tenant could own a row, so every second
-- tenant would have been served Yoga Sadhana's caps, windows and cross-location
-- rate. The check goes, the id becomes generated, and a unique index on
-- `tenant_id` is what now holds each table to one row per studio.
--
-- Tenant #1's existing rows keep their fixed ids — nothing about them moves.
-- The remaining three singletons (`waiver`, `marketing_content`,
-- `feature_flags`) are the content batch's (#62).

ALTER TABLE "global_policy" DROP CONSTRAINT "global_policy_singleton";--> statement-breakpoint
ALTER TABLE "pt_booking_config" DROP CONSTRAINT "pt_booking_config_singleton";--> statement-breakpoint
ALTER TABLE "global_policy" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "pt_booking_config" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
CREATE UNIQUE INDEX "global_policy_tenant_uniq" ON "global_policy" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pt_booking_config_tenant_uniq" ON "pt_booking_config" USING btree ("tenant_id");