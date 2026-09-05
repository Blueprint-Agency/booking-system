-- Give Tenant #1 back the WhatsApp number that used to be a constant.
--
-- `fe-client/src/lib/corporate.ts` held one studio's real number, compiled into
-- the bundle every studio serves, so a member of any other studio who tapped
-- "arrange over WhatsApp" messaged Tenant #1. It now reads
-- `tenant_settings.copy->>'contact.whatsapp'`, and a studio that has published
-- no number simply does not offer the link.
--
-- Without this the rename is a silent regression for the one studio that had a
-- working link: the seed writes `tenant_settings` with ON CONFLICT DO NOTHING,
-- so it never touches a row that already exists, and there is no admin surface
-- for editing copy keys yet. The CTA on /packages and the "arrange over
-- WhatsApp" button on /account/corporate would just stop appearing.
--
-- Merged into `copy` rather than assigned over it, and skipped where the key is
-- already present, so this is a one-way backfill that cannot overwrite anything
-- a studio has since set. `jsonb_exists` rather than the `?` operator, which a
-- driver is entitled to read as a parameter placeholder.
--
-- Scoped by slug, and a no-op on any database where that studio is absent — a
-- fresh install seeds no studio at all (0033's policies, and
-- `src/db/seed/provisioning.ts`, which carries the same number for a seeded
-- environment).
UPDATE tenant_settings AS ts
SET copy = ts.copy || jsonb_build_object('contact.whatsapp', '6582067247'),
    updated_at = now()
FROM tenants AS t
WHERE t.id = ts.tenant_id
  AND t.slug = 'yogasadhana'
  AND NOT jsonb_exists(ts.copy, 'contact.whatsapp');
