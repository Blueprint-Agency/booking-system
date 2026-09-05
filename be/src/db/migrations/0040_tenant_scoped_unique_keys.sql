-- Unique keys that forgot they were in a multi-tenant database.
--
-- Seven unique constraints on Tenant-scoped tables were platform-wide: a
-- booking reference, a QR token, an invitation token and four Stripe payment
-- intent ids. They predate tenancy, and every one of them names something that
-- belongs to a studio rather than to the platform:
--
--   * `bookings.code` is the reference printed on a member's confirmation, and
--     `bookings.qr_token` is what they present at that studio's door. Every
--     query for either already runs inside `withTenant`, so the policies in
--     0033 are what actually find the row; the platform-wide index only meant
--     two studios shared one namespace of short random codes, where a
--     collision in one studio's generator surfaces as a failure in another's.
--   * `staff_invitations.token` is redeemed inside the studio that issued it.
--   * The Stripe intent ids are always looked up as `(tenant_id, intent_id)` —
--     `services/billing/webhook-handler.ts` resolves the Tenant from the
--     client in the intent's metadata *before* it asks about the payment — so
--     nothing depended on the wider constraint.
--
-- The change that forced the issue: a studio's archive could not be restored
-- beside the studio it came from, because these seven were the only values a
-- restore could not rewrite without changing what a member holds in their hand.
-- Scoped to the Tenant, a copy of a studio keeps its members' booking
-- references and QR tokens exactly as they were.
--
-- Narrowing a unique constraint can never fail on existing data: every pair
-- that was unique platform-wide is still unique within a Tenant.
--
-- Guarded throughout, so it is a no-op on a database that has already been
-- reconciled by hand. See migration 0039's header for why that matters here.
ALTER TABLE "staff_invitations" DROP CONSTRAINT IF EXISTS "staff_invitations_token_unique";--> statement-breakpoint
ALTER TABLE "stripe_payments" DROP CONSTRAINT IF EXISTS "stripe_payments_payment_intent_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "staff_invitations_token_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "merch_orders_intent_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "client_packages_stripe_intent_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "bookings_qr_token_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "bookings_code_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "bookings_stripe_intent_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "stripe_payments_intent_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_invitations_token_unique" ON "staff_invitations" USING btree ("tenant_id","token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merch_orders_intent_unique" ON "merch_orders" USING btree ("tenant_id","stripe_payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_packages_stripe_intent_unique" ON "client_packages" USING btree ("tenant_id","stripe_payment_intent_id") WHERE "client_packages"."stripe_payment_intent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_qr_token_unique" ON "bookings" USING btree ("tenant_id","qr_token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_code_unique" ON "bookings" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_stripe_intent_unique" ON "bookings" USING btree ("tenant_id","stripe_payment_intent_id") WHERE "bookings"."stripe_payment_intent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_payments_intent_unique" ON "stripe_payments" USING btree ("tenant_id","payment_intent_id");
