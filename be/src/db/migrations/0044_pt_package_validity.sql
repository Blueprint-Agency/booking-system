-- A PT package carries its own validity in days, like a Credit Bundle does.
--
-- Every PT package sold before this expired 365 days after purchase because a
-- constant in the backend said so. The backfill writes that same 365 onto every
-- existing catalogue row BEFORE the NOT NULL lands, so the constraint can be
-- applied on a live database and no studio's effective behaviour changes on the
-- deploy. Packages already sold are untouched either way — their `expires_at`
-- was stamped at purchase.
ALTER TABLE "pt_packages" ADD COLUMN "validity_days" integer;--> statement-breakpoint
UPDATE "pt_packages" SET "validity_days" = 365 WHERE "validity_days" IS NULL;--> statement-breakpoint
ALTER TABLE "pt_packages" ALTER COLUMN "validity_days" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_packages" ADD CONSTRAINT "pt_packages_validity_days_positive" CHECK ("pt_packages"."validity_days" > 0);
