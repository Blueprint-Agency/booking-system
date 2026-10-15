-- Every email a studio sends goes out under its Business name (#400, spec
-- #397): the From name, the studio named in the email's frame, and the studio
-- named in its subject and body. Two parts.
--
-- 1. The mail identity gives the Business name.
--
-- `current_tenant_mail_identity()` (migration 0036) gains `business_name`, and
-- `services/tenants/mail-identity.ts` reads it first, then falls back as before
-- (mail-from name, `tenants.name`, the platform's name). The same name is the
-- charge description on a member's card statement (`tenantDisplayName`).
--
-- A function's result columns cannot be changed by CREATE OR REPLACE, so it is
-- dropped and made again, with 0036's guarantees: no arguments, answering only
-- for the tenant whose context is open; SECURITY DEFINER with `search_path`
-- pinned; EXECUTE revoked from PUBLIC here and granted to `booking_app` by
-- src/db/roles.ts, which runs after the migrations.
DROP FUNCTION IF EXISTS public.current_tenant_mail_identity();--> statement-breakpoint
CREATE FUNCTION public.current_tenant_mail_identity()
RETURNS TABLE (
  tenant_name text,
  business_name text,
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
         s.mail_from_name,
         s.mail_from_email,
         s.mail_reply_to
  FROM tenants t
  LEFT JOIN tenant_settings s ON s.tenant_id = t.id
  WHERE t.id = nullif(current_setting('app.tenant_id', true), '')::uuid
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.current_tenant_mail_identity() FROM PUBLIC;--> statement-breakpoint

-- 2. Templates name the studio by `{{studio_name}}`, filled at send time.
--
-- A studio's templates were written once, when it was created
-- (db/seed/email-templates.ts), with `tenants.name` written into the ten that
-- name the studio: raw in a subject, HTML-escaped (as escapeHtml does) in a
-- body. A studio created now is given `{{studio_name}}` instead, which
-- `sendTemplatedEmail` fills with the Business name, so a rename reaches the
-- next email without anyone rewriting a template. This brings the placeholder
-- to the studios created before.
--
-- Only to a template nobody has edited. Each candidate is the row with its
-- studio's name swapped for the placeholder; it is written only when that is,
-- byte for byte, the default a studio created today is given. The comparison
-- is by md5 of the default's text (the ten pairs below, of today's
-- db/seed/email-copy.ts built with the placeholder), with two tolerances, as
-- 0105 and 0108 have:
--
--  - The origin of each absolute link (`https://<host>`) reads as one token,
--    because the default bakes in the studio's own member or portal origin,
--    which differ per studio and per environment. The row keeps its own.
--  - A trailing footer note (emailFooterNote) is set aside before comparing and
--    kept on the row as it is: it is provisioning data rather than copy, and
--    only the two isolation fixtures carry one.
--
-- Anything else is left exactly as it is, byte for byte: a studio's own
-- wording, text written by an older release, a studio renamed since its
-- templates were written (whose name no longer matches), and a studio whose
-- name also occurs elsewhere in the copy (the swap would take that too, and the
-- result would not match). The admin template editor answers 501 (#234), so
-- today no studio can have edited one; the check is for the day it can, and for
-- restored archives.
--
-- Rollback (migrations/README.md rule 0): a build from before #400 fills no
-- `{{studio_name}}`, and its renderer turns an unknown variable into nothing, so
-- for as long as such a build runs against this data the swapped templates
-- (and every studio created since) say "Welcome to " with no name after it.
-- Nothing fails and no other studio's name is shown; the words come back with
-- the roll forward.
--
-- Idempotent: a swapped row no longer differs from its candidate, and a row is
-- written only when it would change. Superuser, as every migration runs, so
-- Row-Level Security does not narrow it to one Tenant. No schema change, so its
-- snapshot is the previous one, which is correct.
WITH defaults (slug, subject_md5, body_md5) AS (
  VALUES
    ('welcome', '13f3f63dd24b72ede8cd2a68d3217b0d', 'c51951dbc0a7b72966180203fa8d2a96'),
    ('client_invite', 'ee5daf8285aa42a885258a63aa7f5bd6', 'ec04b2771389af6a94a424ec9a5ad613'),
    ('password_reset', '32fe59513f5bbdd353b4527cc6af55ce', '1895c381ebda9becdacba5c4d736ba93'),
    ('instructor_invite', '2f7203003bee8e81bdb9c00573709856', 'aa072da347666f7187782afc50a7decd'),
    ('admin_invite', '55ebab4dd74e0e1908268e2f1b4bfe23', '53d58349c0bf8faaa77cc1a26647f177'),
    ('referral_credited', '4ebae91f60cd19cb53f54ca0ea7dc25f', '046d92098500e8ec82ad0c91ed5e202e'),
    ('trial_pass_purchase_confirmed', '13f3f63dd24b72ede8cd2a68d3217b0d', '7ac3c6388eda2b39830d1a0c7fff5eb9'),
    ('sign_in_code', 'a44fd096cac80132fda32bda6e7dfa11', 'a41a9fc27c034ecbf21f0fdefecd2ace'),
    ('staff_two_factor_code', '6f6d67f9acf5a14e6c38e113e68588a4', '32d8fa00fb3e725957a261d9e3ac32ae'),
    ('staff_password_reset', 'bdca9b025391f4e0a9c83fe2b5079d56', '513182e0a09613a973bf97e0b4849d65')
),
named AS (
  -- The name as each studio's templates were written with it: raw for a
  -- subject, escaped for a body.
  SELECT t.id AS tenant_id,
         t.name AS raw_name,
         replace(replace(replace(replace(replace(t.name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;') AS html_name
  FROM tenants t
  WHERE t.name <> ''
),
split AS (
  -- The body before its footer note, and the note itself ('' when none).
  SELECT et.tenant_id, et.slug, et.subject, et.body_html, n.raw_name, n.html_name,
         CASE WHEN strpos(et.body_html, E'\n<p data-email-footer-note ') > 0
              THEN left(et.body_html, strpos(et.body_html, E'\n<p data-email-footer-note ') - 1)
              ELSE et.body_html END AS core,
         CASE WHEN strpos(et.body_html, E'\n<p data-email-footer-note ') > 0
              THEN substr(et.body_html, strpos(et.body_html, E'\n<p data-email-footer-note '))
              ELSE '' END AS footer
  FROM email_templates et
  JOIN named n ON n.tenant_id = et.tenant_id
  JOIN defaults d ON d.slug = et.slug
),
candidate AS (
  SELECT s.tenant_id, s.slug, s.subject AS old_subject, s.body_html AS old_body, s.footer,
         replace(s.subject, s.raw_name, '{{studio_name}}') AS subject,
         replace(s.core, s.html_name, '{{studio_name}}') AS core
  FROM split s
  WHERE s.footer = '' OR s.footer ~ '^\n<p data-email-footer-note style="display:none;">[^<]*</p>$'
)
UPDATE email_templates AS et
SET subject = c.subject,
    body_html = c.core || c.footer,
    updated_at = now()
FROM candidate c
JOIN defaults d ON d.slug = c.slug
WHERE et.tenant_id = c.tenant_id
  AND et.slug = c.slug
  AND md5(regexp_replace(c.subject, 'https?://[^/"''<>[:space:]]+', 'ORIGIN', 'g')) = d.subject_md5
  AND md5(regexp_replace(c.core, 'https?://[^/"''<>[:space:]]+', 'ORIGIN', 'g')) = d.body_md5
  AND (c.subject <> c.old_subject OR c.core || c.footer <> c.old_body);
