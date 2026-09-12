-- Every package Activates on its first booking, and one runs per family.
--
-- Before this, only an Unlimited Plan could wait Dormant, and only when bought
-- behind another. A Credit Bundle, trial or PT package had its clock started
-- at purchase, and nothing stopped two of them running side by side. Now:
--
--   * every purchase lands with a null expiry (Dormant), and the first booking
--     it pays for stamps the expiry — one Duration or `validity_days` forward
--     from THAT day;
--   * within a family (class = Credit Bundle + Unlimited + trial; PT on its
--     own) at most one package is Activated at a time, the rest wait.
--
-- `validity_days` is frozen onto the purchase for the same reason
-- `duration_months` already is: Activation reads the length later, and the
-- catalogue row is admin-editable. Backfilled from the source row so the
-- constraint can be strict from the first day.
--
-- The existing rows are converted rather than grandfathered. A package with a
-- clock running but nothing ever booked on it was never Activated in the new
-- sense, so it returns to Dormant and keeps its whole validity for the day it
-- is first used — generous, never lossy. Where two booked packages in one
-- family were both running, the soonest to end stays running and the other
-- waits behind it, which is the state the rule would have produced.
ALTER TABLE "client_packages" DROP CONSTRAINT "client_packages_kind_fields";--> statement-breakpoint
DROP INDEX "client_packages_one_activated_unlimited_per_client";--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "validity_days" integer;--> statement-breakpoint
UPDATE "client_packages" cp
  SET "validity_days" = src."validity_days"
  FROM "class_packages" src
  WHERE cp."source_class_package_id" = src."id"
    AND cp."kind" <> 'unlimited';--> statement-breakpoint
UPDATE "client_packages" cp
  SET "validity_days" = src."validity_days"
  FROM "pt_packages" src
  WHERE cp."source_pt_package_id" = src."id"
    AND cp."kind" = 'pt';--> statement-breakpoint
-- Run the nightly sweep first: a package whose expiry passed since 01:00 is
-- still flagged active, and the two conversions below must neither revive it
-- nor let it hold a family's running slot.
UPDATE "client_packages"
  SET "active" = false
  WHERE "active" AND "expires_at" IS NOT NULL AND "expires_at" <= now();--> statement-breakpoint
-- Never booked on: return to Dormant.
UPDATE "client_packages" cp
  SET "expires_at" = NULL
  WHERE cp."active"
    AND cp."expires_at" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "bookings" b WHERE b."client_package_id" = cp."id")
    AND NOT EXISTS (SELECT 1 FROM "pt_requests" r WHERE r."debited_client_package_id" = cp."id");--> statement-breakpoint
-- Two running in one family: keep the soonest-ending, the rest wait.
UPDATE "client_packages" cp
  SET "expires_at" = NULL
  FROM (
    SELECT "id",
      row_number() OVER (
        PARTITION BY "client_id", ("kind" = 'pt')
        ORDER BY "expires_at" ASC, "purchased_at" ASC
      ) AS rn
    FROM "client_packages"
    WHERE "active" AND "expires_at" IS NOT NULL
  ) ranked
  WHERE cp."id" = ranked."id" AND ranked.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "client_packages_one_activated_class_per_client" ON "client_packages" USING btree ("client_id") WHERE "client_packages"."kind" IN ('credit_bundle', 'unlimited', 'trial') AND "client_packages"."active" AND "client_packages"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "client_packages_one_activated_pt_per_client" ON "client_packages" USING btree ("client_id") WHERE "client_packages"."kind" = 'pt' AND "client_packages"."active" AND "client_packages"."expires_at" IS NOT NULL;--> statement-breakpoint
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
