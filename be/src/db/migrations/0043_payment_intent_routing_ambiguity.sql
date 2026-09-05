-- Whose payment intent is this — and what if two studios say "mine"?
--
-- `tenant_for_payment_intent` (0034) answered with the first row it found. That
-- was exact while `stripe_payments.payment_intent_id` was unique across the
-- platform, and 0040 made it unique per Tenant instead, so that a studio's
-- archive can be restored beside its source. Two rows for one intent is now a
-- legitimate state — and a `charge.refunded` for that intent would have been
-- unwound in whichever studio Postgres happened to return first.
--
-- So the question changes shape: not "which Tenant" but "which Tenants". The
-- caller (`src/db/routing.ts`) treats more than one answer as ambiguity and
-- refuses to act on it, loudly, rather than guess. Same SECURITY DEFINER shape,
-- same pinned `search_path`, same narrow disclosure: tenant ids and nothing
-- else. The old single-answer function is dropped so nothing can keep asking
-- the question the old way.
--
-- EXECUTE is revoked from PUBLIC here and granted to `booking_app` by
-- src/db/roles.ts, which runs after the migrations.
DROP FUNCTION IF EXISTS public.tenant_for_payment_intent(text);--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.tenants_for_payment_intent(p_payment_intent_id text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT tenant_id FROM stripe_payments WHERE payment_intent_id = p_payment_intent_id
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.tenants_for_payment_intent(text) FROM PUBLIC;
