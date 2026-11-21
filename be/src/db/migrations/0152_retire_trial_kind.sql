-- The contract step of retiring kind `trial` (migrations/README.md rule 0;
-- 0150 expanded, 0151 folded the rows). No running build and no rollback image
-- writes `trial` any more, so the value leaves both enums, with the trigger
-- 0150 made to mark such rows (be/CONTEXT.md § Trial).
--
-- The trigger fires on `kind` and its function compares it with 'trial', so
-- both go first; the CHECKs that name `kind` are dropped and remade around the
-- type change, since a constraint written against the old type cannot be
-- carried across. A row written `trial` since 0151 is folded again before.
DROP TRIGGER IF EXISTS "class_packages_kind_trial_is_trial" ON "class_packages";--> statement-breakpoint
DROP TRIGGER IF EXISTS "client_packages_kind_trial_is_trial" ON "client_packages";--> statement-breakpoint
DROP FUNCTION IF EXISTS "kind_trial_is_trial"();--> statement-breakpoint
UPDATE "class_packages" SET "kind" = 'credit_bundle', "is_trial" = true WHERE "kind" = 'trial';--> statement-breakpoint
UPDATE "client_packages" SET "kind" = 'credit_bundle', "is_trial" = true WHERE "kind" = 'trial';--> statement-breakpoint
ALTER TABLE "class_packages" DROP CONSTRAINT "class_packages_kind_fields";--> statement-breakpoint
ALTER TABLE "client_packages" DROP CONSTRAINT "client_packages_kind_fields";--> statement-breakpoint
ALTER TABLE "class_packages" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."class_package_kind";--> statement-breakpoint
CREATE TYPE "public"."class_package_kind" AS ENUM('credit_bundle', 'unlimited');--> statement-breakpoint
ALTER TABLE "class_packages" ALTER COLUMN "kind" SET DATA TYPE "public"."class_package_kind" USING "kind"::"public"."class_package_kind";--> statement-breakpoint
ALTER TABLE "client_packages" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."client_package_kind";--> statement-breakpoint
CREATE TYPE "public"."client_package_kind" AS ENUM('credit_bundle', 'unlimited', 'pt');--> statement-breakpoint
ALTER TABLE "client_packages" ALTER COLUMN "kind" SET DATA TYPE "public"."client_package_kind" USING "kind"::"public"."client_package_kind";--> statement-breakpoint
ALTER TABLE "class_packages" ADD CONSTRAINT "class_packages_kind_fields" CHECK (
        ("class_packages"."kind" = 'credit_bundle'
          AND "class_packages"."credits" IS NOT NULL
          AND "class_packages"."validity_days" IS NOT NULL
          AND "class_packages"."duration_months" IS NULL)
        OR
        ("class_packages"."kind" = 'unlimited'
          AND "class_packages"."credits" IS NULL
          AND "class_packages"."validity_days" IS NULL
          AND "class_packages"."duration_months" IS NOT NULL)
      );--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_kind_fields" CHECK (
        ("client_packages"."kind" = 'unlimited'
          AND "client_packages"."location_id" IS NOT NULL
          AND "client_packages"."duration_months" IS NOT NULL
          AND "client_packages"."validity_days" IS NULL
          AND "client_packages"."bound_instructor_id" IS NULL)
        OR
        ("client_packages"."kind" <> 'unlimited'
          AND "client_packages"."location_id" IS NULL
          AND "client_packages"."duration_months" IS NULL
          AND "client_packages"."validity_days" IS NOT NULL
          AND "client_packages"."cross_location_paid_sgd" IS NULL
          AND ("client_packages"."kind" = 'pt' OR "client_packages"."bound_instructor_id" IS NULL))
      );
