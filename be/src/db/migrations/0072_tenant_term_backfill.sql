-- A studio's Term starts the day it was first provisioned.
--
-- 0071 added `term_start_date` with a `CURRENT_DATE` default, which stamped
-- every existing studio with the day the migration ran. That is the wrong day
-- for all of them: the start of a studio's Term is the day it was created, on
-- its own clock. So it is rewritten from `created_at`, read in the studio's own
-- zone — a studio created at 00:30 local time was created on that local day,
-- whatever the UTC date was.
--
-- Only rows still carrying the migration's own stamp are touched, so re-running
-- this (or running it after an operator has already set a start) never
-- overwrites a date somebody chose.
--
-- `term_end_date` is left null: an open-ended Term. No end is invented for a
-- studio that has been running without one — the operator sets it.
UPDATE tenants
SET term_start_date = (created_at AT TIME ZONE timezone)::date
WHERE term_start_date = CURRENT_DATE
  AND term_start_date <> (created_at AT TIME ZONE timezone)::date;--> statement-breakpoint

-- Is this person still on the staff of any studio?
--
-- Deleting a studio from the super portal removes its `staff_users` rows. A
-- staff member's sign-in account, `staff_auth_users`, is one per person across
-- every studio they work at — so it may only go when no studio still has a staff
-- row for it. The same cross-tenant question 0060 answers for members, refused
-- by the policies from 0033 for the same reason, and answered the same way: one
-- owner-owned SECURITY DEFINER function returning yes or no, never which
-- studio, never a row. Its only caller is `src/services/tenants/delete.ts`.
--
-- `search_path` is pinned for the reason 0034 pins it: a SECURITY DEFINER
-- function without it is a privilege-escalation hole.
--
-- EXECUTE is revoked from PUBLIC here and granted to `booking_app` by
-- src/db/roles.ts, which runs after the migrations.
CREATE OR REPLACE FUNCTION public.staff_auth_user_is_staff(p_auth_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM staff_users WHERE auth_user_id = p_auth_user_id)
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.staff_auth_user_is_staff(text) FROM PUBLIC;
