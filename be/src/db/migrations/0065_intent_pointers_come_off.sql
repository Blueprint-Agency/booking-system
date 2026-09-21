-- The intent pointers come off (#92) — the contract step of the swap 0063 began.
--
-- Nothing in THIS revision reads these columns: a plan and a workshop booking
-- name the Purchase that bought them, and the payment keeps the intent
-- identifier the provider's own calls still need.
--
-- **The revision before it does**, and the deploy migrates before it swaps
-- containers (`.github/workflows/deploy-be.yml`), so between this migration and
-- the swap the outgoing image's package grant, refund-state read and purchase
-- email are querying columns that no longer exist. Webhooks fail loudly and the
-- provider retries them; a member on the confirmation page in that minute sees
-- an error and their purchase lands on the retry. That window is the cost of
-- the contract half, and it is why the fill (0063) is a separate migration:
-- everything it does is safe for both revisions, so only the drop is exposed.
DROP INDEX "client_packages_stripe_intent_unique";--> statement-breakpoint
DROP INDEX "bookings_stripe_intent_unique";--> statement-breakpoint
-- A Complimentary Package is free and reached no payment provider, which 0062
-- stated as "paid 0 and no payment intent". Dropping the column would take the
-- constraint with it silently — Postgres drops a check that names a column it
-- is dropping — so the rule is restated first against the Purchase pointer that
-- replaced the intent. Same rule, read off the record that now owns the money:
-- a grant no sale paid for has no Purchase.
ALTER TABLE "client_packages" DROP CONSTRAINT "client_packages_complimentary_free";--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_complimentary_free" CHECK (NOT "client_packages"."complimentary" OR ("client_packages"."amount_paid_sgd" = 0 AND "client_packages"."purchase_id" IS NULL));--> statement-breakpoint
ALTER TABLE "client_packages" DROP COLUMN "stripe_payment_intent_id";--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "stripe_payment_intent_id";
