-- Every `tenant_id` defaults to tenant #1 for the length of the expand phase.
--
-- Why: the services are being scoped one batch at a time. This batch tightened
-- the reads on identity, policy, catalog and schedule, but the inserts feeding
-- some of those reads live in services that are scoped later (#61, #62) and
-- still name no tenant. Without a default those rows land `NULL` and become
-- invisible to the read beside them — a class that fills up while every surface
-- reports it empty, a member's cancellation cap that never counts. The default
-- keeps every un-migrated write behaving exactly as it did single-tenant.
--
-- ⚠️ This is scaffolding with an expiry date. Once a second tenant is real, a
-- forgotten insert files its row under Yoga Sadhana rather than failing, which
-- is the quiet failure mode this whole plan exists to avoid. It must be dropped
-- by the contract step (#63) that makes the column `NOT NULL`, once #61 and #62
-- have made every insert name its tenant.
--
-- Metadata-only: `SET DEFAULT` rewrites no rows, so this is instant on tables of
-- any size — unlike 0027's backfill.

ALTER TABLE "clients" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "staff_invitations" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "staff_users" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "class_types" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "instructor_class_types" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "instructors" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "leave_conflicts" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "merch" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "merch_orders" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "global_policy" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "pt_booking_config" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "class_packages" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "client_packages" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "corporate_packages" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "promo_code_products" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "promo_code_redemptions" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "promo_codes" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "pt_packages" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "class_supporting_instructors" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "classes" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "corporate_requests" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "corporate_session_supporting_instructors" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "manual_payroll_entries" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "pt_request_slots" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "pt_requests" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "pt_session_clients" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "pt_session_supporting_instructors" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "pt_sessions" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "workshop_days" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "workshop_images" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "workshop_tier_days" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "workshop_tiers" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "workshops" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "cancellations" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "check_ins" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "manual_adjustments" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "stripe_payments" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "email_log" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "email_templates" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "marketing_content" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "waiver" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "inbox_items" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "leave_pools" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "leave_requests" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;--> statement-breakpoint
ALTER TABLE "feature_flags" ALTER COLUMN "tenant_id" SET DEFAULT '10000000-0000-0000-0000-000000000001'::uuid;