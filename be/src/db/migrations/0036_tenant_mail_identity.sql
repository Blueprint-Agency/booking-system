-- Who does a tenant's transactional mail come from?
--
-- The envelope sender cannot be the tenant's own address: the platform's SMTP
-- credentials are not authorised for a studio's domain, so `From: hello@a-studio.com`
-- fails that domain's SPF and carries no DKIM signature for it, and lands in
-- spam or is rejected outright. The mail therefore leaves on the PLATFORM's
-- authenticated envelope and wears the tenant's identity in the two headers
-- that need no DNS: a per-tenant display name, and a per-tenant `Reply-To`.
-- The decision and its upgrade path are recorded in docs/md/mail-identity.md.
--
-- Reading that identity is a problem, because `tenant_settings` is the one
-- tenant-scoped table 0033 leaves without a policy — slug resolution reads it
-- before any tenant context exists — and src/db/roles.ts therefore grants the
-- application role SELECT on the *display* columns by name. The mail columns
-- are deliberately not among them.
--
-- So this function is the read, and it takes no arguments on purpose. It
-- answers only for the tenant whose context is already open, which means the
-- application role cannot ask about a studio it is not currently serving — the
-- same guarantee a policy would have given, expressed where a policy could not
-- go. A caller outside `withTenant` gets no row rather than everyone's.
--
-- `search_path` is pinned for the reason 0034 pins it: a SECURITY DEFINER
-- function without it is a privilege-escalation hole.
--
-- EXECUTE is revoked from PUBLIC here and granted to `booking_app` by
-- src/db/roles.ts, which runs after the migrations.
CREATE OR REPLACE FUNCTION public.current_tenant_mail_identity()
RETURNS TABLE (
  tenant_name text,
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
         s.mail_from_name,
         s.mail_from_email,
         s.mail_reply_to
  FROM tenants t
  LEFT JOIN tenant_settings s ON s.tenant_id = t.id
  WHERE t.id = nullif(current_setting('app.tenant_id', true), '')::uuid
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.current_tenant_mail_identity() FROM PUBLIC;
