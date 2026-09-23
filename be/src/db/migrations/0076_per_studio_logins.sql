-- Per-studio logins (#231): the same email at two studios is two accounts.
--
-- The `staff` and `client` pools' nine tables gain a `tenant_id`, and an address
-- is unique per studio instead of platform-wide. `ensureTenantIsolation`
-- (src/db/roles.ts) then fences them like every other studio table, found by
-- the column name, when the deploy runs it after this. The `platform` pool is
-- untouched: the super portal has no Tenant.
--
-- Hand-edited from the generated migration: the columns go in nullable, the
-- existing rows are split and stamped, and only then do they get their default
-- and NOT NULL. The snapshot is the generated one, so `drizzle-kit generate`
-- afterwards reports no changes.
--
-- **A deliberate exception to "migrations only add".** Dropping the global
-- email unique breaks the previous build's insert-on-conflict (`ensureAuthUser`
-- targeted `email`), so during the deploy window, or on a rollback, invites and
-- member registration on the old image error. Accepted because the product is
-- pre-launch and production is empty.
ALTER TABLE "client_auth_users" DROP CONSTRAINT "client_auth_users_email_unique";--> statement-breakpoint
ALTER TABLE "staff_auth_users" DROP CONSTRAINT "staff_auth_users_email_unique";--> statement-breakpoint
ALTER TABLE "client_auth_users" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "client_auth_accounts" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "client_auth_sessions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "client_auth_verifications" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_auth_users" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_auth_accounts" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_auth_sessions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_auth_verifications" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_auth_two_factors" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint

-- ── The backfill, staff pool (via `staff_users`) ──────────────────────────
--
-- 1. A login no studio has a staff row for belongs to nobody: it goes, and its
--    credentials, second factor and sessions go with it by cascade.
DELETE FROM "staff_auth_users" u
WHERE NOT EXISTS (SELECT 1 FROM "staff_users" s WHERE s."auth_user_id" = u."id");--> statement-breakpoint

-- 2. Each login stays with the studio of its earliest staff row. For every other
--    studio it serves, a copy is made there — same name, same password, same
--    second factor, from then on independent — and that studio's staff row and
--    the sessions claimed on it move to the copy. Nobody is locked out.
CREATE TEMPORARY TABLE "staff_login_split" ON COMMIT DROP AS
SELECT "staff_id", "tenant_id", "old_id", gen_random_uuid()::text AS "new_id"
FROM (
  SELECT
    s."id" AS "staff_id",
    s."tenant_id",
    s."auth_user_id" AS "old_id",
    row_number() OVER (PARTITION BY s."auth_user_id" ORDER BY s."created_at", s."id") AS "nth"
  FROM "staff_users" s
) ranked
WHERE "nth" > 1;--> statement-breakpoint
UPDATE "staff_auth_users" u
SET "tenant_id" = first."tenant_id"
FROM (
  SELECT DISTINCT ON (s."auth_user_id") s."auth_user_id", s."tenant_id"
  FROM "staff_users" s
  ORDER BY s."auth_user_id", s."created_at", s."id"
) first
WHERE first."auth_user_id" = u."id";--> statement-breakpoint
INSERT INTO "staff_auth_users"
  ("id", "name", "email", "email_verified", "image", "created_at", "updated_at", "two_factor_enabled", "tenant_id")
SELECT m."new_id", u."name", u."email", u."email_verified", u."image", u."created_at", u."updated_at", u."two_factor_enabled", m."tenant_id"
FROM "staff_login_split" m
JOIN "staff_auth_users" u ON u."id" = m."old_id";--> statement-breakpoint
INSERT INTO "staff_auth_accounts"
  ("id", "account_id", "provider_id", "user_id", "access_token", "refresh_token", "id_token",
   "access_token_expires_at", "refresh_token_expires_at", "scope", "password", "created_at", "updated_at", "tenant_id")
SELECT gen_random_uuid()::text, m."new_id", a."provider_id", m."new_id", a."access_token", a."refresh_token", a."id_token",
  a."access_token_expires_at", a."refresh_token_expires_at", a."scope", a."password", a."created_at", a."updated_at", m."tenant_id"
FROM "staff_login_split" m
JOIN "staff_auth_accounts" a ON a."user_id" = m."old_id" AND a."provider_id" = 'credential';--> statement-breakpoint
INSERT INTO "staff_auth_two_factors"
  ("id", "secret", "backup_codes", "user_id", "verified", "failed_verification_count", "locked_until", "tenant_id")
SELECT gen_random_uuid()::text, t."secret", t."backup_codes", m."new_id", t."verified", t."failed_verification_count", t."locked_until", m."tenant_id"
FROM "staff_login_split" m
JOIN "staff_auth_two_factors" t ON t."user_id" = m."old_id";--> statement-breakpoint
UPDATE "staff_users" s
SET "auth_user_id" = m."new_id"
FROM "staff_login_split" m
WHERE s."id" = m."staff_id";--> statement-breakpoint
UPDATE "staff_auth_sessions" x
SET "user_id" = m."new_id"
FROM "staff_login_split" m
WHERE x."user_id" = m."old_id" AND x."claimed_tenant_id" = m."tenant_id";--> statement-breakpoint

-- 3. Credentials, second factors and sessions belong to their login's studio. A
--    session with no claim, or claimed on a studio its login is not at, cannot
--    be attributed, and ends.
UPDATE "staff_auth_accounts" a SET "tenant_id" = u."tenant_id"
FROM "staff_auth_users" u WHERE a."user_id" = u."id" AND a."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "staff_auth_two_factors" t SET "tenant_id" = u."tenant_id"
FROM "staff_auth_users" u WHERE t."user_id" = u."id" AND t."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "staff_auth_sessions" x SET "tenant_id" = u."tenant_id"
FROM "staff_auth_users" u WHERE x."user_id" = u."id";--> statement-breakpoint
DELETE FROM "staff_auth_sessions"
WHERE "claimed_tenant_id" IS NULL OR "claimed_tenant_id" IS DISTINCT FROM "tenant_id";--> statement-breakpoint

-- 4. Verifications — reset links and emailed codes — live minutes, and say
--    nothing of the studio they were asked for at. They go.
DELETE FROM "staff_auth_verifications";--> statement-breakpoint

-- ── The backfill, client pool (via `clients`) — the same four steps ───────
DELETE FROM "client_auth_users" u
WHERE NOT EXISTS (SELECT 1 FROM "clients" c WHERE c."auth_user_id" = u."id");--> statement-breakpoint
CREATE TEMPORARY TABLE "client_login_split" ON COMMIT DROP AS
SELECT "client_id", "tenant_id", "old_id", gen_random_uuid()::text AS "new_id"
FROM (
  SELECT
    c."id" AS "client_id",
    c."tenant_id",
    c."auth_user_id" AS "old_id",
    row_number() OVER (PARTITION BY c."auth_user_id" ORDER BY c."created_at", c."id") AS "nth"
  FROM "clients" c
) ranked
WHERE "nth" > 1;--> statement-breakpoint
UPDATE "client_auth_users" u
SET "tenant_id" = first."tenant_id"
FROM (
  SELECT DISTINCT ON (c."auth_user_id") c."auth_user_id", c."tenant_id"
  FROM "clients" c
  ORDER BY c."auth_user_id", c."created_at", c."id"
) first
WHERE first."auth_user_id" = u."id";--> statement-breakpoint
INSERT INTO "client_auth_users"
  ("id", "name", "email", "email_verified", "image", "created_at", "updated_at", "tenant_id")
SELECT m."new_id", u."name", u."email", u."email_verified", u."image", u."created_at", u."updated_at", m."tenant_id"
FROM "client_login_split" m
JOIN "client_auth_users" u ON u."id" = m."old_id";--> statement-breakpoint
INSERT INTO "client_auth_accounts"
  ("id", "account_id", "provider_id", "user_id", "access_token", "refresh_token", "id_token",
   "access_token_expires_at", "refresh_token_expires_at", "scope", "password", "created_at", "updated_at", "tenant_id")
SELECT gen_random_uuid()::text, m."new_id", a."provider_id", m."new_id", a."access_token", a."refresh_token", a."id_token",
  a."access_token_expires_at", a."refresh_token_expires_at", a."scope", a."password", a."created_at", a."updated_at", m."tenant_id"
FROM "client_login_split" m
JOIN "client_auth_accounts" a ON a."user_id" = m."old_id" AND a."provider_id" = 'credential';--> statement-breakpoint
UPDATE "clients" c
SET "auth_user_id" = m."new_id"
FROM "client_login_split" m
WHERE c."id" = m."client_id";--> statement-breakpoint
UPDATE "client_auth_sessions" x
SET "user_id" = m."new_id"
FROM "client_login_split" m
WHERE x."user_id" = m."old_id" AND x."claimed_tenant_id" = m."tenant_id";--> statement-breakpoint
UPDATE "client_auth_accounts" a SET "tenant_id" = u."tenant_id"
FROM "client_auth_users" u WHERE a."user_id" = u."id" AND a."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "client_auth_sessions" x SET "tenant_id" = u."tenant_id"
FROM "client_auth_users" u WHERE x."user_id" = u."id";--> statement-breakpoint
DELETE FROM "client_auth_sessions"
WHERE "claimed_tenant_id" IS NULL OR "claimed_tenant_id" IS DISTINCT FROM "tenant_id";--> statement-breakpoint
DELETE FROM "client_auth_verifications";--> statement-breakpoint

-- ── Now every row has its studio: the default, NOT NULL, keys and indexes ─
--
-- The default is the transaction's Tenant: Better Auth writes sessions,
-- credentials, verifications and second factors itself and cannot be told one.
-- Outside a Tenant context it is null, and the insert fails on NOT NULL.
ALTER TABLE "client_auth_users" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid;--> statement-breakpoint
ALTER TABLE "client_auth_accounts" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid;--> statement-breakpoint
ALTER TABLE "client_auth_sessions" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid;--> statement-breakpoint
ALTER TABLE "client_auth_verifications" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid;--> statement-breakpoint
ALTER TABLE "staff_auth_users" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid;--> statement-breakpoint
ALTER TABLE "staff_auth_accounts" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid;--> statement-breakpoint
ALTER TABLE "staff_auth_sessions" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid;--> statement-breakpoint
ALTER TABLE "staff_auth_verifications" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid;--> statement-breakpoint
ALTER TABLE "staff_auth_two_factors" ALTER COLUMN "tenant_id" SET DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid;--> statement-breakpoint
ALTER TABLE "client_auth_users" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "client_auth_accounts" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "client_auth_sessions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "client_auth_verifications" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_auth_users" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_auth_accounts" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_auth_sessions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_auth_verifications" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_auth_two_factors" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "client_auth_accounts" ADD CONSTRAINT "client_auth_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_auth_sessions" ADD CONSTRAINT "client_auth_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_auth_users" ADD CONSTRAINT "client_auth_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_auth_verifications" ADD CONSTRAINT "client_auth_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_auth_accounts" ADD CONSTRAINT "staff_auth_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_auth_sessions" ADD CONSTRAINT "staff_auth_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_auth_two_factors" ADD CONSTRAINT "staff_auth_two_factors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_auth_users" ADD CONSTRAINT "staff_auth_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_auth_verifications" ADD CONSTRAINT "staff_auth_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_auth_accounts_tenant_idx" ON "client_auth_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "client_auth_sessions_tenant_idx" ON "client_auth_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "client_auth_verifications_tenant_idx" ON "client_auth_verifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "staff_auth_accounts_tenant_idx" ON "staff_auth_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "staff_auth_sessions_tenant_idx" ON "staff_auth_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "staff_auth_two_factors_tenant_idx" ON "staff_auth_two_factors" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "staff_auth_verifications_tenant_idx" ON "staff_auth_verifications" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "client_auth_users" ADD CONSTRAINT "client_auth_users_tenant_email_unique" UNIQUE("tenant_id","email");--> statement-breakpoint
ALTER TABLE "staff_auth_users" ADD CONSTRAINT "staff_auth_users_tenant_email_unique" UNIQUE("tenant_id","email");
