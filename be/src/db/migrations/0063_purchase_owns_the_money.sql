-- A Purchase owns the money, and a payment is evidence of part of it (#91).
--
-- Until now one purchase was one payment intent, and that assumption was
-- load-bearing across plans, workshops, Merch and Cross-Location Add-Ons. This
-- is the expand half of an expand–contract: the Purchase record arrives, the
-- payments point at it, every historical payment is backfilled to one, and
-- **nothing is granted until the Balance reaches zero**. Refunds move onto the
-- Purchase and the old intent pointers come off in the ticket that follows.
--
-- No behaviour changes here. Every sale is still settled in one payment, so
-- every Purchase this creates closes on its first payment, exactly as before.
CREATE TYPE "public"."purchase_kind" AS ENUM('class_package', 'pt_package', 'workshop', 'merch', 'cross_location_add_on', 'corporate_package');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('open', 'paid', 'refunded', 'abandoned');--> statement-breakpoint
CREATE TABLE "purchases" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "purchase_kind" NOT NULL,
	"total_sgd" numeric(10, 2) NOT NULL,
	"amount_paid_sgd" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"status" "purchase_status" DEFAULT 'open' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checkout_session_id" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stripe_payments" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchases_client_created_idx" ON "purchases" USING btree ("tenant_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX "purchases_status_idx" ON "purchases" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_checkout_session_unique" ON "purchases" USING btree ("tenant_id","checkout_session_id");--> statement-breakpoint
ALTER TABLE "stripe_payments" ADD CONSTRAINT "stripe_payments_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stripe_payments_purchase_idx" ON "stripe_payments" USING btree ("tenant_id","purchase_id");--> statement-breakpoint

-- Row-Level Security, written here as well as swept in by `ensureTenantIsolation`
-- on every deploy (src/db/roles.ts). The sweep is what guarantees it; this is
-- what makes a database that has only ever had `db:migrate` run against it —
-- a scratch database, a restored dump — correct from the moment the table
-- exists rather than from the next deploy. Same predicate as migration 0033;
-- FORCE so the owner is subject to it too.
ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "purchases";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "purchases"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- The backfill. Every payment this system has ever taken becomes the Purchase
-- it was evidence of, with no gaps: one payment, one Purchase, the payment's
-- own amount as both the total and the amount paid.
--
-- The Purchase reuses the payment's own uuid as its id. That is not a shortcut
-- — it is what makes the pairing below provably one-to-one without a temporary
-- mapping table, and it makes the whole backfill re-runnable, because a second
-- pass collides on the primary key rather than inserting a second Purchase for
-- the same money.
--
-- `status` is mapped through rather than set to 'paid' for everything: a
-- refunded payment backfills to a refunded Purchase and a failed one to an
-- abandoned Purchase, which is what those rows already mean. `metadata` is
-- empty because there is nothing left to grant from — every one of these
-- Purchases is closed.
--
-- `amount_paid_sgd` means money currently held, which is what
-- `services/billing/balance.ts` computes: a refunded payment counts for
-- nothing there, so it counts for nothing here either. The two must agree —
-- the stored figure is derived from the ledger, never a second opinion about
-- it. A payment still `pending` when this ran is the one row that could go
-- stale, and does not: its Purchase is reachable from the payment row, so the
-- webhook recomputes it when the payment lands (`purchaseForPayment`).
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
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint

UPDATE stripe_payments SET purchase_id = id WHERE purchase_id IS NULL;