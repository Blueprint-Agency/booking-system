-- A Promo Code's text stops being unique across the *platform* and becomes
-- unique **per tenant**.
--
-- One namespace for every studio is the same mistake `global_policy` made
-- (0028) read from the other end: the first tenant to create SUMMER would have
-- kept every other tenant off the word, and the 23505 would have told them it
-- was taken somewhere they cannot see. Two studios running a code called
-- SUMMER is normal, and only the pair (tenant, code) has to be unique.
--
-- Redemption stays scoped by the same pair — `readCode` resolves what the
-- member typed within their own tenant, so the two SUMMERs never meet.
--
-- `tenant_id` goes `NOT NULL` on this one table, ahead of the contract step
-- (#63) that turns it on the other 52. It has to: Postgres treats NULLs as
-- distinct in a unique index, so leaving it nullable would make the uniqueness
-- of a code's text conditional on a column nothing yet enforces — two rows
-- could both be SUMMER and neither would be found by the `(tenant_id, code)`
-- lookup that redeems them. Every existing row was backfilled by 0027 and the
-- column has defaulted since 0029, so this cannot fail on real data.

DROP INDEX "promo_codes_code_unique";--> statement-breakpoint
ALTER TABLE "promo_codes" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_tenant_code_unique" ON "promo_codes" USING btree ("tenant_id","code");