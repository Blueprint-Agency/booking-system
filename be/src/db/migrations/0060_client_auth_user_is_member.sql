-- Is this person still a member of any studio?
--
-- Permanently deleting a member (#144) removes their `clients` row at one
-- studio. Their sign-in account, `client_auth_users`, is one per person across
-- every studio they have joined — so it may only go when no studio still has a
-- member row for it. Answering that is the cross-tenant read the policies from
-- 0033 refuse: the delete runs inside the acting studio's `withTenant`, and
-- `clients` shows it that studio's rows and nobody else's.
--
-- So: the shape 0034 and 0041 use. One owner-owned SECURITY DEFINER function
-- answering one narrow question — yes or no, never which studio, never a row —
-- with `src/services/clients/member-delete.ts` as its only caller. What it
-- discloses to a caller that reached it another way is whether an auth user id
-- they already hold is a member somewhere.
--
-- `search_path` is pinned for the reason 0034 pins it: a SECURITY DEFINER
-- function without it is a privilege-escalation hole.
--
-- EXECUTE is revoked from PUBLIC here and granted to `booking_app` by
-- src/db/roles.ts, which runs after the migrations.
CREATE OR REPLACE FUNCTION public.client_auth_user_is_member(p_auth_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM clients WHERE auth_user_id = p_auth_user_id)
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.client_auth_user_is_member(text) FROM PUBLIC;
