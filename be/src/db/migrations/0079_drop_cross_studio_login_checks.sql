-- The contract step after per-studio logins (#231, #258).
--
-- 0060 and 0072 added two cross-Tenant SECURITY DEFINER checks, asked before a
-- member's or a studio's deletion removed a login that other studios might
-- still share. Since 0076 a login belongs to one studio, so both deletions
-- remove the studio's own logins inside its Tenant context, and nothing calls
-- either check. They were kept through that deploy for an older image still
-- running beside it; that image is gone from production, so they go now.
--
-- The two single-column `auth_user_id` indexes existed only to serve them. No
-- foreign key sits on that column, and every lookup by it names the Tenant,
-- which the (tenant_id, auth_user_id) uniques already index.
--
-- Generated for the two indexes, then the two `DROP FUNCTION`s added by hand:
-- the snapshot does not track functions, so it is the generated one unchanged.
DROP INDEX "clients_auth_user_id_idx";--> statement-breakpoint
DROP INDEX "staff_users_auth_user_id_idx";--> statement-breakpoint
DROP FUNCTION IF EXISTS public.client_auth_user_is_member(text);--> statement-breakpoint
DROP FUNCTION IF EXISTS public.staff_auth_user_is_staff(text);
