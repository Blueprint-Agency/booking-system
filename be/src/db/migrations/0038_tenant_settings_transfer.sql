-- Reading and writing a studio's whole `tenant_settings` row, for export and
-- import, without handing the application role the columns it is deliberately
-- fenced out of.
--
-- `tenant_settings` is the one Tenant-scoped table migration 0033 leaves without
-- a policy: slug resolution reads it *before* any Tenant context exists, so a
-- policy keyed on that context could only refuse the request that establishes
-- it. Column privileges stand in — src/db/roles.ts grants `booking_app` SELECT
-- on the branding a studio publishes to its own visitors and nothing else, so
-- the mail-from identity and the waiver text are unreadable across tenants.
--
-- That control is right, and it is exactly why a studio export could not read
-- its own settings: `SELECT *` is refused. The answer is not to widen the grant,
-- which would make every request able to read every studio's waiver. It is the
-- same shape 0036 used for the mail identity — a SECURITY DEFINER function that
-- answers only for the Tenant whose context is currently open. The fence stays
-- where it is; one door is cut in it, and the door only opens onto the room the
-- caller is already standing in.
--
-- A caller outside `withTenant` gets no row rather than everyone's, because
-- `current_setting('app.tenant_id', true)` is NULL and the comparison is false.
--
-- `search_path` is pinned for the reason 0034 and 0036 pin it: a SECURITY
-- DEFINER function without it is a privilege-escalation hole.
--
-- EXECUTE is revoked from PUBLIC here and granted to `booking_app` by
-- src/db/roles.ts, which runs after the migrations.

CREATE OR REPLACE FUNCTION public.current_tenant_settings()
RETURNS TABLE (
  tenant_id uuid,
  display_name text,
  logo_url text,
  favicon_url text,
  og_image_url text,
  tagline text,
  copy jsonb,
  theme jsonb,
  mail_from_name text,
  mail_from_email text,
  mail_reply_to text,
  waiver_text text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.tenant_id, s.display_name, s.logo_url, s.favicon_url, s.og_image_url,
         s.tagline, s.copy, s.theme, s.mail_from_name, s.mail_from_email,
         s.mail_reply_to, s.waiver_text, s.created_at, s.updated_at
  FROM tenant_settings s
  WHERE s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.current_tenant_settings() FROM PUBLIC;--> statement-breakpoint

-- The writer half, for a restore.
--
-- Same fence, same door: it writes only the row for the Tenant whose context is
-- open, so an archive cannot be used to overwrite another studio's branding,
-- mail identity or waiver — not by a bug, and not on purpose. The Tenant is
-- taken from the context and never from an argument, which is what makes that
-- true rather than merely intended.
CREATE OR REPLACE FUNCTION public.write_current_tenant_settings(
  p_display_name text,
  p_logo_url text,
  p_favicon_url text,
  p_og_image_url text,
  p_tagline text,
  p_copy jsonb,
  p_theme jsonb,
  p_mail_from_name text,
  p_mail_from_email text,
  p_mail_reply_to text,
  p_waiver_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF target IS NULL THEN
    RAISE EXCEPTION 'write_current_tenant_settings: no tenant context is open';
  END IF;

  INSERT INTO tenant_settings (
    tenant_id, display_name, logo_url, favicon_url, og_image_url, tagline,
    copy, theme, mail_from_name, mail_from_email, mail_reply_to, waiver_text
  ) VALUES (
    target, p_display_name, p_logo_url, p_favicon_url, p_og_image_url, p_tagline,
    coalesce(p_copy, '{}'::jsonb), coalesce(p_theme, '{}'::jsonb),
    p_mail_from_name, p_mail_from_email, p_mail_reply_to, p_waiver_text
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    display_name    = EXCLUDED.display_name,
    logo_url        = EXCLUDED.logo_url,
    favicon_url     = EXCLUDED.favicon_url,
    og_image_url    = EXCLUDED.og_image_url,
    tagline         = EXCLUDED.tagline,
    copy            = EXCLUDED.copy,
    theme           = EXCLUDED.theme,
    mail_from_name  = EXCLUDED.mail_from_name,
    mail_from_email = EXCLUDED.mail_from_email,
    mail_reply_to   = EXCLUDED.mail_reply_to,
    waiver_text     = EXCLUDED.waiver_text,
    updated_at      = now();
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.write_current_tenant_settings(
  text, text, text, text, text, jsonb, jsonb, text, text, text, text
) FROM PUBLIC;
