-- A trial is a tick on its parent package, not a kind of its own: a Credit
-- Bundle, an Unlimited Plan, a PT 1on1 or a PT 2on1 package may be one
-- (be/CONTEXT.md § Trial). The expand step of migrations/README.md rule 0:
-- the columns are added and every existing trial is marked, and kind `trial`
-- stays where it is, so the build still running while this migrates (and one
-- a rollback returns to) reads the same Credit Bundle trials it always did.
-- It knows nothing of an Unlimited or PT trial the new build makes (kind
-- `unlimited` / `pt` with only `is_trial` set): back on the old build those sell
-- as ordinary packages, so a rollback must take them off sale. The new build
-- keeps writing kind `trial` for a Credit Bundle trial; a later migration
-- folds it into `credit_bundle` once no running build reads it.
ALTER TABLE "class_packages" ADD COLUMN "is_trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "is_trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_packages" ADD COLUMN "is_trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "class_packages" SET "is_trial" = true WHERE "kind" = 'trial';--> statement-breakpoint
UPDATE "client_packages" SET "is_trial" = true WHERE "kind" = 'trial';--> statement-breakpoint
-- Until the contract step, kind `trial` still means a trial, whoever writes it:
-- the old build (during the deploy, or after a rollback), which knows nothing
-- of `is_trial`, and a Mindbody import's archive. A row written `trial` is
-- marked here, so nothing it writes is a trial the new build cannot see. The
-- contract migration drops both triggers and the function with the kind.
CREATE FUNCTION "kind_trial_is_trial"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kind" = 'trial' THEN
    NEW."is_trial" := true;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "class_packages_kind_trial_is_trial" BEFORE INSERT OR UPDATE OF "kind" ON "class_packages"
  FOR EACH ROW EXECUTE FUNCTION "kind_trial_is_trial"();--> statement-breakpoint
CREATE TRIGGER "client_packages_kind_trial_is_trial" BEFORE INSERT OR UPDATE OF "kind" ON "client_packages"
  FOR EACH ROW EXECUTE FUNCTION "kind_trial_is_trial"();
