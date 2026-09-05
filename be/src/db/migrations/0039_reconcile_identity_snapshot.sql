-- Reconciles the Drizzle snapshot chain with the database. On every existing
-- database this is a no-op; on a fresh one it is already true. It exists so that
-- `npm run db:generate` stops inventing a migration.
--
-- **What went wrong.** Migration 0035 swapped four platform-wide unique
-- constraints for per-Tenant composites, and was written `--custom`. A custom
-- migration ships no snapshot, so `meta/` has none for 0035, 0036 or 0038 and
-- the newest one on disk was 0034's — which describes the database *before* the
-- swap. `drizzle-kit generate` compares the schema against that, concludes the
-- four constraints still need swapping, and emits them again. Worse, it emits
-- them without `IF EXISTS`, so running the result fails on
-- `constraint "clients_clerk_user_id_unique" does not exist` — which is how this
-- was found, twice, by someone running `db:generate` for an unrelated reason.
--
-- **The fix is the snapshot, not this file.** `meta/0039_snapshot.json` is the
-- first accurate snapshot since 0034 — generated from the schema itself, so it
-- records the composites — and its presence is what makes the next
-- `db:generate` answer "No schema changes, nothing to migrate". This SQL is the
-- migration that snapshot belongs to, written so that applying it can never be
-- the thing that breaks a deploy.
--
-- See issue #75 for the second half of the problem: journal `when` values that
-- are not monotonic cause a migration to be *silently skipped*.
--
-- Everything below is guarded. `DROP ... IF EXISTS` is the form 0035 used and
-- the generated file omitted; `ADD CONSTRAINT` has no `IF NOT EXISTS` in
-- Postgres, so each is guarded by a catalogue lookup instead.

ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_clerk_user_id_unique";--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_email_unique";--> statement-breakpoint
ALTER TABLE "staff_users" DROP CONSTRAINT IF EXISTS "staff_users_clerk_user_id_unique";--> statement-breakpoint
ALTER TABLE "staff_users" DROP CONSTRAINT IF EXISTS "staff_users_email_unique";--> statement-breakpoint

DO $$
DECLARE
  wanted record;
BEGIN
  FOR wanted IN
    SELECT * FROM (VALUES
      ('clients',     'clients_tenant_clerk_user_unique',     'tenant_id, clerk_user_id'),
      ('clients',     'clients_tenant_email_unique',          'tenant_id, email'),
      ('staff_users', 'staff_users_tenant_clerk_user_unique', 'tenant_id, clerk_user_id'),
      ('staff_users', 'staff_users_tenant_email_unique',      'tenant_id, email')
    ) AS t(table_name, constraint_name, columns)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = wanted.constraint_name
        AND conrelid = format('public.%I', wanted.table_name)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (%s)',
        wanted.table_name, wanted.constraint_name, wanted.columns
      );
    END IF;
  END LOOP;
END $$;
