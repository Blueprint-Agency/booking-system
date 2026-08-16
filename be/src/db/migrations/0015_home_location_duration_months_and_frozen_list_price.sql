ALTER TABLE "class_packages" RENAME COLUMN "duration_days" TO "duration_months";--> statement-breakpoint
-- The rename carries the old values across unchanged, so every catalogue row is
-- now a day-count sitting in a months column — "12-Month Unlimited" reading 365
-- months. The seed is insert-if-absent and will not correct a row that already
-- exists, so the conversion has to happen here, while we still know the unit.
-- The seeded durations (90, 180, 365) land exactly on 3, 6 and 12.
UPDATE "class_packages" SET "duration_months" = ROUND("duration_months" / 30.0)
  WHERE "duration_months" IS NOT NULL AND "duration_months" > 24;--> statement-breakpoint
ALTER TABLE "class_packages" DROP CONSTRAINT "class_packages_kind_fields";--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "duration_months" integer;--> statement-breakpoint
-- Hand-edited from the generated `ADD COLUMN ... NOT NULL`, which fails against a
-- non-empty table. The backfill probe found production empty but staging holding 3
-- purchased packages, all paid at full list price with no code redeemed — so paid
-- IS the list price for every existing row. Add nullable, backfill, then constrain.
ALTER TABLE "client_packages" ADD COLUMN "list_price_sgd" numeric(10, 2);--> statement-breakpoint
UPDATE "client_packages" SET "list_price_sgd" = "amount_paid_sgd" WHERE "list_price_sgd" IS NULL;--> statement-breakpoint
ALTER TABLE "client_packages" ALTER COLUMN "list_price_sgd" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "list_price_sgd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "amount_paid_sgd" numeric(10, 2);--> statement-breakpoint
-- Same reason as the backfill above: `bookings_kind_money` below validates every
-- existing row, so any workshop booking already on the table would fail it with a
-- null it never had the chance to write. The tier's regular price is the only
-- record of what was charged — which is exactly the hole §15 exists to close, so
-- these rows get the best number available rather than a guess at early-bird.
UPDATE "bookings" b SET "list_price_sgd" = t."regular_price_sgd", "amount_paid_sgd" = t."regular_price_sgd"
  FROM "workshop_tiers" t
  WHERE b."workshop_tier_id" = t."id" AND b."kind" = 'workshop' AND b."list_price_sgd" IS NULL;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
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
        OR
        ("class_packages"."kind" = 'trial'
          AND "class_packages"."credits" IS NOT NULL
          AND "class_packages"."validity_days" IS NOT NULL
          AND "class_packages"."duration_months" IS NULL)
      );--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_kind_fields" CHECK (
        ("client_packages"."kind" = 'unlimited'
          AND "client_packages"."location_id" IS NOT NULL
          AND "client_packages"."duration_months" IS NOT NULL)
        OR
        ("client_packages"."kind" <> 'unlimited'
          AND "client_packages"."location_id" IS NULL
          AND "client_packages"."duration_months" IS NULL
          AND "client_packages"."expires_at" IS NOT NULL)
      );--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_kind_money" CHECK (("bookings"."kind" = 'workshop' AND "bookings"."list_price_sgd" IS NOT NULL AND "bookings"."amount_paid_sgd" IS NOT NULL)
        OR ("bookings"."kind" <> 'workshop' AND "bookings"."list_price_sgd" IS NULL AND "bookings"."amount_paid_sgd" IS NULL));