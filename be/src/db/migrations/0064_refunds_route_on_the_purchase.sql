-- Refunds route on the Purchase, and the intent pointers come off (#92).
--
-- The contract half of #91's expand–contract. A plan and a workshop booking
-- stop naming a payment intent and name the sale instead, which is the only
-- shape that survives a Purchase settled by more than one payment: there is one
-- Purchase to point at, and any number of intents.
--
-- This migration is the expand step of the swap — it adds the pointers, fills
-- them from the ledger and closes `stripe_payments.purchase_id`. The old columns
-- come off in 0065, once nothing reads them.

-- The plan's Purchase, found through the payment that bought it. The intent is
-- unique per Tenant on both sides, so this pairs each plan with at most one
-- payment and therefore at most one Purchase — which is what the new partial
-- unique index below asserts.
--
-- An Add-On payment also carries `client_package_id`, pointing at the plan it
-- extends; matching on the intent rather than on that column is what keeps the
-- Add-On's own money from claiming the plan's Purchase.
ALTER TABLE "client_packages" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Any payment 0063 did not reach — one taken between that migration and this
-- one, by a checkout session created before Purchases existed — gets the same
-- treatment it would have got there: one payment, one Purchase, the payment's
-- own uuid as its id, so the pairing stays provably one-to-one and this stays
-- re-runnable.
INSERT INTO purchases (
  tenant_id, id, client_id, kind, total_sgd, amount_paid_sgd,
  status, metadata, checkout_session_id, settled_at, created_at
)
SELECT
  sp.tenant_id,
  sp.id,
  sp.client_id,
  sp.kind::text::purchase_kind,
  sp.amount_sgd,
  CASE WHEN sp.status = 'succeeded' THEN sp.amount_sgd ELSE 0.00 END,
  (CASE sp.status
     WHEN 'succeeded' THEN 'paid'
     WHEN 'refunded'  THEN 'refunded'
     WHEN 'failed'    THEN 'abandoned'
     ELSE 'open'
   END)::purchase_status,
  '{}'::jsonb,
  NULL,
  CASE WHEN sp.status IN ('succeeded', 'refunded') THEN sp.created_at END,
  sp.created_at
FROM stripe_payments sp
WHERE sp.purchase_id IS NULL
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint

UPDATE stripe_payments SET purchase_id = id WHERE purchase_id IS NULL;--> statement-breakpoint

-- With no gaps left, the column closes. From here a payment always names the
-- sale it is evidence of part of, which is what lets a Refund walk a Purchase's
-- payments instead of being handed one intent and hoping it is the only one.
ALTER TABLE "stripe_payments" ALTER COLUMN "purchase_id" SET NOT NULL;--> statement-breakpoint

UPDATE client_packages cp
SET purchase_id = sp.purchase_id
FROM stripe_payments sp
WHERE sp.tenant_id = cp.tenant_id
  AND sp.payment_intent_id = cp.stripe_payment_intent_id
  AND cp.stripe_payment_intent_id IS NOT NULL
  AND cp.purchase_id IS NULL;--> statement-breakpoint

UPDATE bookings b
SET purchase_id = sp.purchase_id
FROM stripe_payments sp
WHERE sp.tenant_id = b.tenant_id
  AND sp.payment_intent_id = b.stripe_payment_intent_id
  AND b.stripe_payment_intent_id IS NOT NULL
  AND b.purchase_id IS NULL;--> statement-breakpoint

-- Partial, in the place the intent's partial unique held: a comp grant, a $0
-- trial and every class or PT booking carry no Purchase, and any number of them
-- may exist. Where there is one it decides a redelivery race, exactly as before.
CREATE UNIQUE INDEX "client_packages_purchase_unique" ON "client_packages" USING btree ("tenant_id","purchase_id") WHERE "client_packages"."purchase_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_purchase_unique" ON "bookings" USING btree ("tenant_id","purchase_id") WHERE "bookings"."purchase_id" IS NOT NULL;
