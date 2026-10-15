-- A studio's Business name (#398): the one name it trades under, which replaces
-- the Receipt's separate Legal name (#391).
--
-- Filled from the Legal name where the studio set one, otherwise from its
-- display name, otherwise from `tenants.name` (the Domain name), so a studio
-- that had a Legal name keeps it and none is left nameless. Then the Legal name
-- goes, and a Receipt's copy of it is renamed to what it now holds.
--
-- Written to run twice: `business-name-migration.test.ts` runs it again against
-- a studio given a Legal name back, as one migrated from before would have.
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "business_name" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "receipt_legal_name" text;--> statement-breakpoint
UPDATE "tenant_settings" s
SET "business_name" = COALESCE(
  NULLIF(btrim(s."receipt_legal_name"), ''),
  NULLIF(btrim(s."business_name"), ''),
  NULLIF(btrim(s."display_name"), ''),
  t."name"
)
FROM "tenants" t
WHERE t."id" = s."tenant_id";--> statement-breakpoint
ALTER TABLE "tenant_settings" ALTER COLUMN "business_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN IF EXISTS "receipt_legal_name";--> statement-breakpoint

-- The backstop for a writer that names no Business name: a restore through
-- `write_current_tenant_settings` (migration 0038) or `createTenant`. It takes
-- the studio's display name, else its Domain name, as the backfill above did.
-- The super portal and the Business details page always name one.
CREATE OR REPLACE FUNCTION public.tenant_settings_business_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.business_name IS NULL OR btrim(NEW.business_name) = '' THEN
    NEW.business_name := COALESCE(
      NULLIF(btrim(NEW.display_name), ''),
      (SELECT t.name FROM tenants t WHERE t.id = NEW.tenant_id)
    );
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER "tenant_settings_business_name"
  BEFORE INSERT OR UPDATE ON "tenant_settings"
  FOR EACH ROW EXECUTE FUNCTION public.tenant_settings_business_name();--> statement-breakpoint

-- Receipts keep what they were issued with: the Legal name a Receipt carried
-- is now its Business name, value for value.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'receipts' AND column_name = 'seller_legal_name'
  ) THEN
    ALTER TABLE "receipts" RENAME COLUMN "seller_legal_name" TO "seller_business_name";
  END IF;
END;
$$;
