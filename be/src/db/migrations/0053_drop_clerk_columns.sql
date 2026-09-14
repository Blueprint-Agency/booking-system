-- Clerk removal, step 2 of 2 (#121): drop what nothing reads any more.
--
-- `clerk_user_id` on both identity tables, and the two Clerk Organization ids
-- on `tenants`. Only after 0052, whose check is what proves every row already
-- has the `auth_user_id` that replaces its Clerk id. Take the backup first.
--
-- With them go the three SECURITY DEFINER lookups 0035 made for the Clerk
-- webhooks' tenant routing, whose only callers are gone: two read the dropped
-- column, and the third would leave the app role able to ask which studios hold
-- staff at an address, across tenants, for no caller at all.
DROP FUNCTION IF EXISTS public.tenants_for_clerk_client_user(text);--> statement-breakpoint
DROP FUNCTION IF EXISTS public.tenants_for_clerk_staff_user(text);--> statement-breakpoint
DROP FUNCTION IF EXISTS public.tenants_for_staff_email(text);--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_clerk_client_org_id_unique";--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_clerk_portal_org_id_unique";--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT "clients_tenant_clerk_user_unique";--> statement-breakpoint
ALTER TABLE "staff_users" DROP CONSTRAINT "staff_users_tenant_clerk_user_unique";--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "clerk_client_org_id";--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "clerk_portal_org_id";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "clerk_user_id";--> statement-breakpoint
ALTER TABLE "staff_users" DROP COLUMN "clerk_user_id";
