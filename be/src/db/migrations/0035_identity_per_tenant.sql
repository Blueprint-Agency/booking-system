-- One person, two studios.
--
-- `clients` and `staff_users` were born single-tenant, so their `clerk_user_id`
-- and `email` are unique across the whole platform. That is the same sentence as
-- "nobody may be a member of two studios" — which the spec explicitly wants to
-- work, and which today fails as a duplicate-key error at sign-up rather than as
-- anything a person could understand.
--
-- The uniqueness that was wanted all along is per Tenant: one row per person per
-- studio, and independent records at each. Widening the key is what makes the
-- second membership possible; it does not weaken the first, because every read
-- already runs inside a Tenant context that the policies in 0033 enforce.
--
-- Nothing needs backfilling: a narrower unique cannot have admitted a row that
-- the wider one refuses.
ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_clerk_user_id_unique";--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_email_unique";--> statement-breakpoint
ALTER TABLE "staff_users" DROP CONSTRAINT IF EXISTS "staff_users_clerk_user_id_unique";--> statement-breakpoint
ALTER TABLE "staff_users" DROP CONSTRAINT IF EXISTS "staff_users_email_unique";--> statement-breakpoint

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_tenant_clerk_user_unique" UNIQUE ("tenant_id", "clerk_user_id");--> statement-breakpoint
ALTER TABLE "clients"
  ADD CONSTRAINT "clients_tenant_email_unique" UNIQUE ("tenant_id", "email");--> statement-breakpoint
ALTER TABLE "staff_users"
  ADD CONSTRAINT "staff_users_tenant_clerk_user_unique" UNIQUE ("tenant_id", "clerk_user_id");--> statement-breakpoint
ALTER TABLE "staff_users"
  ADD CONSTRAINT "staff_users_tenant_email_unique" UNIQUE ("tenant_id", "email");--> statement-breakpoint

-- Which Tenants already know this Clerk user?
--
-- The Clerk webhook is one endpoint for both Clerk applications, on a hostname
-- that carries no Tenant, with a `user.updated` payload that names an identity
-- and nothing else. Answering "whose rows should this update?" is precisely the
-- cross-tenant read the policies refuse — so, exactly as migration 0034 did for
-- the payment provider, the lookup is a `SECURITY DEFINER` function that returns
-- ids and no row data.
--
-- `SETOF`, not one value, is the whole point: a person in two studios has two
-- rows, and the webhook updates both.
--
-- `search_path` is pinned, without which a SECURITY DEFINER function is a
-- privilege-escalation hole: a caller who can create a schema could otherwise
-- shadow `clients` with their own table and have the owner read it.
--
-- EXECUTE is revoked from PUBLIC here and granted to `booking_app` by
-- src/db/roles.ts, which runs after the migrations.
CREATE OR REPLACE FUNCTION public.tenants_for_clerk_client_user(p_clerk_user_id text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM clients WHERE clerk_user_id = p_clerk_user_id
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.tenants_for_clerk_staff_user(p_clerk_user_id text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM staff_users WHERE clerk_user_id = p_clerk_user_id
$$;--> statement-breakpoint

-- The staff webhook links a pre-seeded row by email, and the email is the only
-- thing the payload carries — so the same question is asked that way too.
CREATE OR REPLACE FUNCTION public.tenants_for_staff_email(p_email text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM staff_users WHERE lower(email) = lower(p_email) AND deleted_at IS NULL
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.tenants_for_clerk_client_user(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenants_for_clerk_staff_user(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenants_for_staff_email(text) FROM PUBLIC;
