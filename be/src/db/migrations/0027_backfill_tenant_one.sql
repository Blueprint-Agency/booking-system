-- Expand step, part 2 of 2: Yoga Sadhana becomes tenant #1 and every existing
-- row is claimed by it. Pure data — 0026 already added the (nullable) columns,
-- so this migration changes no schema and its snapshot is a verbatim copy of
-- 0026's, per migrations/README.md §3.
--
-- The id is fixed rather than generated so every environment (local, staging,
-- production, the test harness) agrees on which tenant is #1.
--
-- Idempotent: the insert is ON CONFLICT DO NOTHING and every UPDATE is guarded
-- by `tenant_id IS NULL`, so re-running claims only rows written since.
--
-- Cost: this rewrites every row of all 53 tables, inside drizzle's single
-- per-migration transaction, in the same `db:migrate` step the deploy runs. At
-- one studio's volume that is seconds; if the append-only tables (`audit_log`,
-- `email_log`, `bookings`, `check_ins`, `stripe_payments`) have grown large by
-- the time this is applied to production, apply it in a maintenance window —
-- it holds row locks for its duration and a timeout rolls the whole backfill
-- back.

INSERT INTO "tenants" ("id", "slug", "name", "timezone", "status")
VALUES (
	'10000000-0000-0000-0000-000000000001',
	'yogasadhana',
	'Yoga Sadhana',
	'Asia/Singapore',
	'active'
)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- Settings start from what the single-tenant system already had: its name and,
-- where a waiver has been written, its waiver body.
INSERT INTO "tenant_settings" ("tenant_id", "display_name", "waiver_text")
VALUES (
	'10000000-0000-0000-0000-000000000001',
	'Yoga Sadhana',
	(SELECT "body_html" FROM "waiver" LIMIT 1)
)
ON CONFLICT ("tenant_id") DO NOTHING;--> statement-breakpoint

UPDATE "audit_log" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "bookings" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "cancellations" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "check_ins" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "class_packages" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "class_supporting_instructors" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "class_types" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "classes" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "client_packages" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "clients" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "corporate_packages" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "corporate_requests" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "corporate_session_supporting_instructors" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "corporate_sessions" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "email_log" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "email_templates" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "feature_flags" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "global_policy" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "inbox_items" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "instructor_class_types" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "instructors" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "leave_conflicts" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "leave_pools" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "leave_requests" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "locations" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "manual_adjustments" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "manual_payroll_entries" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "marketing_content" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "merch" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "merch_orders" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "promo_code_products" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "promo_code_redemptions" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "promo_codes" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "promotions" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "pt_booking_config" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "pt_packages" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "pt_request_slots" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "pt_requests" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "pt_session_clients" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "pt_session_supporting_instructors" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "pt_sessions" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "rooms" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "staff_invitations" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "staff_users" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "stripe_payments" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "waiver" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "waiver_signatures" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "workshop_days" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "workshop_images" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "workshop_instructors" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "workshop_tier_days" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "workshop_tiers" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "workshops" SET "tenant_id" = '10000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
