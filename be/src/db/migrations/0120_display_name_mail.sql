-- Every email a studio sends goes out under its Display name, the everyday name
-- its apps already call it by (`tenant_settings.display_name`), and no longer
-- under its Business name, which stays the formal name on its Receipts and card
-- charges. `services/tenants/mail-identity.ts` reads the Display name first,
-- then the Business name, then `tenants.name`, then the platform's name.
--
-- `current_tenant_mail_identity()` (migrations 0036, 0117) gains
-- `display_name`. A function's result columns cannot be changed by CREATE OR
-- REPLACE, so it is dropped and made again with 0036's guarantees: no
-- arguments, answering only for the tenant whose context is open; SECURITY
-- DEFINER with `search_path` pinned; EXECUTE revoked from PUBLIC here and
-- granted to `booking_app` by src/db/roles.ts, which runs after the migrations.
--
-- Rollback (migrations/README.md rule 0): a build from before this reads the
-- columns it names and ignores the new one, so it keeps signing with the
-- Business name. No schema change, so its snapshot is the previous one.
DROP FUNCTION IF EXISTS public.current_tenant_mail_identity();--> statement-breakpoint
CREATE FUNCTION public.current_tenant_mail_identity()
RETURNS TABLE (
  tenant_name text,
  business_name text,
  display_name text,
  from_name text,
  from_email text,
  reply_to text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.name,
         s.business_name,
         s.display_name,
         s.mail_from_name,
         s.mail_from_email,
         s.mail_reply_to
  FROM tenants t
  LEFT JOIN tenant_settings s ON s.tenant_id = t.id
  WHERE t.id = nullif(current_setting('app.tenant_id', true), '')::uuid
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.current_tenant_mail_identity() FROM PUBLIC;
