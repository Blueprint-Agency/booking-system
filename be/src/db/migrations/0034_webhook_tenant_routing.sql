-- Which Tenant is this webhook about?
--
-- A payment provider calls one endpoint, on a hostname that carries no tenant,
-- with a body that names an intent and a client and nothing else. Every other
-- entry point learns its tenant from the request; a webhook has to look it up —
-- and after 0033 the application role cannot, because the lookup it needs is
-- precisely the cross-tenant read the policies refuse.
--
-- These two functions are that lookup, and nothing more. `SECURITY DEFINER`
-- runs them as the owner, so they see every row; each takes an identifier the
-- caller already holds (Stripe just handed it over, signed) and returns only a
-- tenant id. No row data crosses the boundary — only the answer to "whose is
-- this?", which is the one question a webhook cannot answer for itself.
--
-- `search_path` is pinned, without which a SECURITY DEFINER function is a
-- privilege-escalation hole: a caller who can create a schema could otherwise
-- shadow `clients` with their own table and have the owner read it.
--
-- EXECUTE is revoked from PUBLIC here and granted to `booking_app` by
-- src/db/roles.ts, which runs after the migrations (the role may not exist yet
-- when this file is applied to a fresh database).
CREATE OR REPLACE FUNCTION public.tenant_for_client(p_client_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM clients WHERE id = p_client_id
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.tenant_for_payment_intent(p_payment_intent_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM stripe_payments WHERE payment_intent_id = p_payment_intent_id
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.tenant_for_client(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.tenant_for_payment_intent(text) FROM PUBLIC;
