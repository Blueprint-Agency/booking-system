-- A member is somebody at the payment provider, so a card can be saved (#185).
--
-- Every checkout this platform has ever created carried `customer_email` and
-- nothing else. An email is not something a card can be attached to, so no card
-- was ever kept: a member paying one Purchase with two cards typed both numbers
-- in full, and typed them again on the next Purchase. The Part Payment flow
-- (#93) made that the ordinary path rather than an edge case — it is *designed*
-- to be paid twice — which is what turned a missing convenience into a missing
-- feature.
--
-- This table is the missing pointer: the member, and who they are on the
-- provider account the studio sells on.
--
-- ## Why the account is in the key
--
-- A Customer id is meaningless on any account but the one that issued it. Since
-- #100 a studio can supply its own credentials, so "which account?" is a
-- question about the studio's configuration today, not about the member. A
-- studio that moves accounts leaves its members' Customers behind exactly as it
-- leaves its payments behind (`stripe_payments.provider_account_id`, migration
-- 0068), and the first checkout on the new account makes each member a Customer
-- there. Both rows then live side by side, and each is only ever read together
-- with the account it belongs to.
--
-- So NULL here means the same thing it means on a payment: **the platform's own
-- account**, deliberately, and not "unknown". Nothing needs backfilling,
-- because nothing existed before.
--
-- ## Nothing in here is a secret
--
-- Not a card number, not a key, not an amount. `cus_…` is a pointer, and the
-- worst a total loss of this table could do is ask every member to type a card
-- number one more time. It is listed in `member-tables.ts` as a row that is
-- **deleted** with the member rather than emptied, unlike every accounts row
-- beside it: the studio's books do not need it, and it is the member's identity
-- at a third party, which is precisely what permanent deletion (#144) is for.
CREATE TABLE "payment_customers" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"provider_account_id" text,
	"customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "payment_customers" ADD CONSTRAINT "payment_customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_customers" ADD CONSTRAINT "payment_customers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- One Customer per member per account.
--
-- `NULLS NOT DISTINCT` is the whole point and is why this index is written by
-- hand: Postgres's default treats every NULL as distinct from every other, and
-- the platform's own account — the common case, and the only case for a studio
-- that has supplied no credentials — *is* the NULL. A plain unique index would
-- therefore enforce nothing at all for exactly the studios that have not been
-- onboarded onto their own account yet, and a member would quietly end up with
-- two Customers and half their cards behind each.
CREATE UNIQUE INDEX "payment_customers_member_account_unique"
  ON "payment_customers" USING btree ("tenant_id","client_id","provider_account_id")
  NULLS NOT DISTINCT;--> statement-breakpoint

-- Row-Level Security, written here as well as swept in by `ensureTenantIsolation`
-- on every deploy (src/db/roles.ts). The sweep is what guarantees it; this is
-- what makes a database that has only ever had `db:migrate` run against it —
-- a scratch database, a restored dump — correct from the moment the table
-- exists rather than from the next deploy. Same predicate as migration 0033;
-- FORCE so the owner is subject to it too.
ALTER TABLE "payment_customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "payment_customers";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payment_customers"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

COMMENT ON COLUMN payment_customers.provider_account_id IS
  'The provider account this Customer exists on; NULL is the platform''s own. A Customer id is meaningless on any other account, so this is part of the key the lookup uses, never a detail hanging off it.';
