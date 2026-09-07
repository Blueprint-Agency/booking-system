-- A payment records the provider account it was taken on.
--
-- Until now "which account is this studio's money on?" was answered by reading
-- the studio's *current* credentials (#100). That answer is right for a charge,
-- which happens now, and wrong for a Refund, which happens later — possibly
-- years later, and possibly after the studio has moved onto an account of its
-- own.
--
-- A studio's historical payments cannot be moved with it. Stripe has no way to
-- hand a payment intent from one account to another, so a sale taken on the
-- platform's account stays on the platform's account for as long as anybody
-- might want to return it. Asking the studio's current credentials would send
-- that refund to the wrong account, where the intent does not exist: the member
-- gets nothing back and an admin gets an error naming an id that looks correct.
--
-- So the fact is written down at the moment it is true, on the payment itself.
--
-- NULL is the platform's own account — deliberately, and not "unknown". Every
-- payment taken before this column existed was taken on the platform account,
-- because that is the only account this platform had; so the default is also
-- the correct backfill, and no backfill statement is needed. It is the same
-- reading `providerAccountForTenant` gives a studio that has supplied no
-- credentials, so one convention covers the column and the accessor both.
--
-- Nothing is indexed on it, either. Refunds read a Purchase's payments by
-- (tenant, purchase), which `stripe_payments_purchase_idx` already covers, and
-- the account is never a search key — only a column read off a row that has
-- already been found.
ALTER TABLE stripe_payments
  ADD COLUMN IF NOT EXISTS provider_account_id text;--> statement-breakpoint

COMMENT ON COLUMN stripe_payments.provider_account_id IS
  'The provider account this payment was taken on; NULL is the platform''s own. Written at capture and never updated — a Refund is issued on the account the money came in on, which is not necessarily the account the studio sells on today.';
