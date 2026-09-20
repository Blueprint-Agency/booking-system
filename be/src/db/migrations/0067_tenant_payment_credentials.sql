-- A Tenant supplies its own payment-provider credentials.
--
-- There is no platform account in the middle and no connected account: Stripe
-- Connect is unavailable to this platform (a Malaysian platform may not collect
-- application fees on connected accounts outside Malaysia, and Tenant #1 is
-- Singaporean — see issue #100). So a studio hands over the credentials to its
-- OWN provider account, and every call on that studio's behalf is made against
-- that account directly. The money is taken on the studio's account and lands in
-- the studio's bank, because the account *is* the studio's.
--
-- Which makes this table different in kind from every other tenant-scoped table
-- here. It holds a secret belonging to somebody else, so:
--
--   * both secrets are stored sealed (AES-256-GCM, src/lib/secret-box.ts). The
--     key is in the environment, so a database backup is not a set of live
--     payment keys and a leaked key is not a database.
--   * `account_id` is deliberately NOT sealed. It names the account and is not
--     a credential, and it is the one thing the super portal shows back — "these
--     credentials exist, and they belong to acct_xxx" — so that a human can tell
--     a studio's own account from a mistake without ever seeing the secret.
--
-- A Tenant with no row here charges on the platform account, exactly as every
-- Tenant did before this. That is what lets studios be moved one at a time.
CREATE TABLE IF NOT EXISTS tenant_payment_credentials (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- One provider today. Named rather than assumed so a second one is a row, not
  -- a migration that has to guess what the existing rows meant.
  provider text NOT NULL DEFAULT 'stripe',
  account_id text NOT NULL,
  secret_key_sealed text NOT NULL,
  webhook_secret_sealed text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

-- The same policy every other tenant-scoped table carries (0033). The DO block
-- there only reached the tables that existed when it ran, so a new one says it
-- itself. FORCE so the owner is subject to it too.
ALTER TABLE tenant_payment_credentials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tenant_payment_credentials FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON tenant_payment_credentials;--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant_payment_credentials
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- The read, for callers that have no Tenant context to open.
--
-- The policy above is right for every write and for anything happening inside a
-- request, but two paths cannot satisfy it. A background job and a provider
-- webhook both arrive with no context at all — and the webhook's whole problem
-- is that it cannot open one until it knows which studio signed the delivery,
-- which is precisely what these credentials answer.
--
-- So the lookup runs as the owner, takes the tenant id the caller already holds,
-- and returns that one studio's row. It is the same narrow door 0034 opened for
-- webhook routing: one question, one answer, no cross-tenant scan.
--
-- What crosses the boundary is still SEALED. The owner-owned function grants no
-- access to the plaintext — that needs the environment's key as well, which the
-- database does not have. Losing this function is not losing the secrets.
--
-- `search_path` is pinned for the reason 0034 pins it: a SECURITY DEFINER
-- function without it is a privilege-escalation hole.
CREATE OR REPLACE FUNCTION public.tenant_payment_credentials_for(p_tenant_id uuid)
RETURNS TABLE (
  account_id text,
  secret_key_sealed text,
  webhook_secret_sealed text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.account_id, c.secret_key_sealed, c.webhook_secret_sealed
  FROM tenant_payment_credentials c
  WHERE c.tenant_id = p_tenant_id AND c.provider = 'stripe'
$$;--> statement-breakpoint

-- Which studios have an account of their own, for the super portal's list.
--
-- Cross-tenant by definition — it is a list of every studio — and it returns
-- only the two facts that surface is allowed to show: whose account, and which
-- one. No sealed value is in the result at all, so this cannot become a way to
-- pull the credentials out one studio at a time.
CREATE OR REPLACE FUNCTION public.tenant_payment_accounts()
RETURNS TABLE (
  tenant_id uuid,
  account_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.tenant_id, c.account_id
  FROM tenant_payment_credentials c
  WHERE c.provider = 'stripe'
$$;--> statement-breakpoint

-- EXECUTE is revoked from PUBLIC here and granted to `booking_app` by
-- src/db/roles.ts, which runs after the migrations.
REVOKE ALL ON FUNCTION public.tenant_payment_credentials_for(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_payment_accounts() FROM PUBLIC;
