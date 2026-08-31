-- The last three platform singletons — `waiver`, `marketing_content` and
-- `feature_flags` — become per-tenant, and an email template's slug stops being
-- a platform namespace.
--
-- 0028 did this for `global_policy` and `pt_booking_config` and named these as
-- the content batch's (#62). The shape is the same and so is the reason: a
-- `CHECK (id = '<fixed uuid>')` means no second tenant can own a row, so every
-- second tenant is served the first one's waiver text and the first one's home
-- page. The check goes, the id becomes generated, and a unique index on
-- `tenant_id` is what holds each table to one row per studio.
--
-- `email_templates` is the promo-code shape instead (0030): every tenant has a
-- row for every slug — `welcome`, `leave_approved` — and only the wording
-- differs, so it is the pair (tenant, slug) that is unique. A platform-unique
-- slug would have left one studio's words, links and sign-off in another
-- studio's outbox.
--
-- `feature_flags` had `key` as its whole primary key, which made every switch a
-- platform switch: turning a feature on for one studio turned it on for all of
-- them, and the second studio to try would have collided on a row it cannot
-- see. The key becomes the (tenant, key) pair.
--
-- `tenant_id` goes `NOT NULL` on those two tables ahead of the contract step
-- (#63), for the reason 0030 gives: Postgres treats NULLs as distinct in a
-- unique index, so a nullable column would let two rows both be `welcome` while
-- the (tenant, slug) lookup that renders them finds neither. On `feature_flags`
-- it is simply half of the primary key. Every existing row was backfilled by
-- 0027 and the column has defaulted since 0029, so neither can fail on real
-- data.

ALTER TABLE "email_templates" DROP CONSTRAINT "email_templates_slug_unique";--> statement-breakpoint
ALTER TABLE "marketing_content" DROP CONSTRAINT "marketing_content_singleton";--> statement-breakpoint
ALTER TABLE "waiver" DROP CONSTRAINT "waiver_singleton";--> statement-breakpoint
ALTER TABLE "email_templates" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "marketing_content" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "waiver" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "feature_flags" DROP CONSTRAINT "feature_flags_pkey";--> statement-breakpoint
ALTER TABLE "feature_flags" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_key_pk" PRIMARY KEY("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_tenant_slug_unique" ON "email_templates" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_content_tenant_uniq" ON "marketing_content" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_tenant_uniq" ON "waiver" USING btree ("tenant_id");
