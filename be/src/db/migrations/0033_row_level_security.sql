-- Row-Level Security: the point at which isolation stops depending on every
-- developer remembering a `WHERE tenant_id = ?` and starts being refused by the
-- database.
--
-- One policy per Tenant-scoped table, keyed on a transaction-local setting:
--
--     tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
--
-- `true` as the second argument to `current_setting` means "return NULL rather
-- than erroring when the setting is absent", and `nullif` covers the empty
-- string a reset leaves behind. Both matter: an unset context must make the
-- policy *false* (no rows, and an INSERT refused by the WITH CHECK), not raise
-- — a policy that errors is a policy someone disables.
--
-- The setting is written per transaction by `withTenant` in src/db/index.ts.
-- Session scope would leak between requests on a pooled connection, which is
-- the failure this whole design exists to make impossible.
--
-- ⚠️ ENABLE alone protects nobody who owns the table, and nothing at all
-- protects a superuser. This migration is only half the control: the other half
-- is the backend connecting as `booking_app` — a non-superuser role that owns
-- none of these tables — which src/db/roles.ts provisions. Revert the connection
-- to the owner and every policy below silently becomes decoration.
--
-- Excluded, deliberately:
--   * `tenants` — the directory. It has no `tenant_id`, and slug resolution
--     reads it *before* any tenant context exists.
--   * `tenant_settings` — read on the same pre-context path (the slug lookup
--     joins it). A policy keyed on the Tenant context could only refuse the very
--     request that establishes it. Column privileges stand in instead: the app
--     role is granted SELECT on the branding columns a studio publishes and no
--     others, so the mail-from identity and the waiver text are unreadable
--     across tenants. That grant lives in src/db/roles.ts, because it has to be
--     re-applied after every deploy's table-level grant, and it fails closed —
--     a column added later is invisible until someone names it public.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
      AND table_name <> 'tenant_settings'
    ORDER BY table_name
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE so the table owner is subject to its own policy too. A superuser
    -- still bypasses both, which is why migrations and seeds keep working.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I'
      || ' USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)'
      || ' WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;
