-- A fresh database should hold no studio. Migration 0027 leaves a placeholder
-- "Tenant One" behind on one, so the super portal lists a studio nobody created.
-- This removes it — but only while it is still the untouched placeholder:
--
--   - the slug is still `tenant-one` (an operator who renamed it kept it), and
--   - no row anywhere points at it: every `*tenant_id` column in `public` other
--     than `tenant_settings`, the one row 0027 wrote beside it.
--
-- On a database where 0027 claimed a real studio's rows (production), that
-- studio owns data, so nothing happens. Pure data; the snapshot is 0053's copy.
-- The test harness seeds its fixture tenant #1 afterwards by upsert, so it is
-- unaffected.

DO $$
DECLARE
	placeholder constant uuid := '10000000-0000-0000-0000-000000000001';
	col record;
	owned boolean;
BEGIN
	IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = placeholder AND slug = 'tenant-one') THEN
		RETURN;
	END IF;

	FOR col IN
		SELECT table_name, column_name
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND column_name LIKE '%tenant_id'
			AND table_name NOT IN ('tenants', 'tenant_settings')
	LOOP
		EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)', col.table_name, col.column_name)
			INTO owned USING placeholder;
		IF owned THEN
			RETURN;
		END IF;
	END LOOP;

	DELETE FROM tenant_settings WHERE tenant_id = placeholder;
	DELETE FROM tenants WHERE id = placeholder;
END $$;
