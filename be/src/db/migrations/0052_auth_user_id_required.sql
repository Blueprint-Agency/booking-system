-- Clerk removal, step 1 of 2 (#121): tighten, drop nothing.
--
-- `auth_user_id` becomes NOT NULL on `clients` and `staff_users`. Every row got
-- one from the Clerk user import (#120), every invitation writes one (#115) and
-- every member registration writes one (#117), so a NULL here is a row nobody
-- can sign in as. The check below refuses the migration by name rather than
-- with Postgres's bare "column contains null values": on an environment where
-- the import has not run, stop here, run it (docs/md/deployment.md), and retry.
-- 0053, which drops `clerk_user_id` — the only record of who such a row was —
-- cannot run before this has succeeded.
--
-- `staff_invitations.invited_by_staff_id` becomes nullable: a studio's first
-- admin is invited from the super portal, by nobody on the studio's staff.
DO $$
DECLARE
  unmapped_clients bigint;
  unmapped_staff bigint;
BEGIN
  SELECT count(*) INTO unmapped_clients FROM "clients" WHERE "auth_user_id" IS NULL;
  SELECT count(*) INTO unmapped_staff FROM "staff_users" WHERE "auth_user_id" IS NULL;
  IF unmapped_clients > 0 OR unmapped_staff > 0 THEN
    RAISE EXCEPTION 'auth_user_id is missing on % clients and % staff_users rows — run the user import (#120) before migrating', unmapped_clients, unmapped_staff;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "auth_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_invitations" ALTER COLUMN "invited_by_staff_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_users" ALTER COLUMN "auth_user_id" SET NOT NULL;
