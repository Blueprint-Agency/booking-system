-- Which studios have nobody who can sign in?
--
-- A studio can now be provisioned without a first admin, because a studio
-- created to receive an archive must have an empty `staff_users` — the archive
-- brings its own and the import refuses to merge. That is a legitimate step and
-- a terrible resting place: a studio with no staff row is a studio nobody can
-- get into, and nothing on the platform would have said so.
--
-- The super portal is where that has to be visible, and the super portal is
-- cross-tenant: it runs outside any `withTenant`, so the Row-Level Security
-- policies from 0033 show the application role nothing at all in `staff_users`.
-- A per-studio loop would work and would be one transaction per studio on every
-- refresh of the list.
--
-- So: the same shape 0034 uses for webhook routing. One owner-owned
-- SECURITY DEFINER function, answering one narrow question — a count per
-- tenant, never a row — with `src/services/tenants/tenants.ts` as its only
-- caller. What it discloses to a caller that reached it another way is how many
-- staff each studio has, and nothing about who they are.
--
-- Pending counts. An invited admin has not accepted yet, but they are a way in:
-- the studio is reachable and needs no further intervention. Archived and
-- soft-deleted rows do not, for the same reason `requireActiveStaff` refuses
-- them at the door.
--
-- `search_path` is pinned for the reason 0034 pins it: a SECURITY DEFINER
-- function without it is a privilege-escalation hole.
--
-- EXECUTE is revoked from PUBLIC here and granted to `booking_app` by
-- src/db/roles.ts, which runs after the migrations.
CREATE OR REPLACE FUNCTION public.tenant_staff_counts()
RETURNS TABLE (tenant_id uuid, staff_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.tenant_id, count(*)::int
  FROM staff_users s
  WHERE s.deleted_at IS NULL
    AND s.status <> 'archived'
  GROUP BY s.tenant_id
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.tenant_staff_counts() FROM PUBLIC;
