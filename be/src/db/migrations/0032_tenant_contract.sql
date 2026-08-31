-- The contract half of expand-migrate-contract (#63).
--
--   1. Every `tenant_id` becomes NOT NULL and loses the tenant-#1 default that
--      0029 added as scaffolding. From here an insert that forgets its tenant
--      fails loudly instead of filing somebody else's row under Yoga Sadhana.
--   2. Every non-unique index is rebuilt with `tenant_id` leading, because every
--      query now filters on it first. Unique indexes are deliberately untouched:
--      folding the tenant into them would CHANGE what is unique (a globally
--      unique QR token, Stripe intent or booking code must stay globally
--      unique), which is a different decision from a lookup index.
--
-- Row-Level Security itself is 0033 — it needs the app role, so it is separate.
--
-- Belt-and-braces backfill first. 0027 backfilled every row that existed then
-- and 0029 defaulted every row written since, so this should be a no-op — but a
-- row inserted between those two deploys would abort the whole migration on the
-- SET NOT NULL below, and finding that out on a production deploy is not the
-- moment. Scoped to columns still nullable so a re-run costs nothing.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id' AND is_nullable = 'YES'
  LOOP
    EXECUTE format(
      'UPDATE %I SET tenant_id = %L::uuid WHERE tenant_id IS NULL',
      t, '10000000-0000-0000-0000-000000000001'
    );
  END LOOP;
END $$;--> statement-breakpoint
DROP INDEX "clients_status_idx";--> statement-breakpoint
DROP INDEX "clients_referrer_idx";--> statement-breakpoint
DROP INDEX "clients_name_lower_idx";--> statement-breakpoint
DROP INDEX "clients_deleted_idx";--> statement-breakpoint
DROP INDEX "staff_invitations_email_status_idx";--> statement-breakpoint
DROP INDEX "staff_invitations_inviter_idx";--> statement-breakpoint
DROP INDEX "staff_role_status_idx";--> statement-breakpoint
DROP INDEX "staff_users_deleted_idx";--> statement-breakpoint
DROP INDEX "class_types_archived_idx";--> statement-breakpoint
DROP INDEX "class_types_deleted_idx";--> statement-breakpoint
DROP INDEX "class_types_name_lower_idx";--> statement-breakpoint
DROP INDEX "class_types_parent_idx";--> statement-breakpoint
DROP INDEX "locations_archived_idx";--> statement-breakpoint
DROP INDEX "locations_deleted_idx";--> statement-breakpoint
DROP INDEX "merch_archived_idx";--> statement-breakpoint
DROP INDEX "merch_orders_client_created_idx";--> statement-breakpoint
DROP INDEX "rooms_location_archived_idx";--> statement-breakpoint
DROP INDEX "rooms_deleted_idx";--> statement-breakpoint
DROP INDEX "class_packages_status_kind_idx";--> statement-breakpoint
DROP INDEX "class_packages_deleted_idx";--> statement-breakpoint
DROP INDEX "client_packages_client_kind_idx";--> statement-breakpoint
DROP INDEX "client_packages_client_expiry_idx";--> statement-breakpoint
DROP INDEX "corporate_packages_status_idx";--> statement-breakpoint
DROP INDEX "corporate_packages_deleted_idx";--> statement-breakpoint
DROP INDEX "promotions_parent_lookup_idx";--> statement-breakpoint
DROP INDEX "promotions_sort_idx";--> statement-breakpoint
DROP INDEX "class_supporting_instructors_instructor_idx";--> statement-breakpoint
DROP INDEX "classes_starts_at_idx";--> statement-breakpoint
DROP INDEX "classes_main_instructor_starts_idx";--> statement-breakpoint
DROP INDEX "classes_location_starts_idx";--> statement-breakpoint
DROP INDEX "classes_room_starts_idx";--> statement-breakpoint
DROP INDEX "classes_class_type_idx";--> statement-breakpoint
DROP INDEX "classes_lifecycle_starts_idx";--> statement-breakpoint
DROP INDEX "corporate_requests_status_created_idx";--> statement-breakpoint
DROP INDEX "corporate_requests_client_status_idx";--> statement-breakpoint
DROP INDEX "corporate_session_supporting_instructors_instructor_idx";--> statement-breakpoint
DROP INDEX "corporate_sessions_starts_at_idx";--> statement-breakpoint
DROP INDEX "corporate_sessions_instructor_starts_idx";--> statement-breakpoint
DROP INDEX "corporate_sessions_location_starts_idx";--> statement-breakpoint
DROP INDEX "corporate_sessions_room_starts_idx";--> statement-breakpoint
DROP INDEX "corporate_sessions_lifecycle_starts_idx";--> statement-breakpoint
DROP INDEX "manual_payroll_entries_instructor_entry_date_idx";--> statement-breakpoint
DROP INDEX "pt_request_slots_request_idx";--> statement-breakpoint
DROP INDEX "pt_requests_status_created_idx";--> statement-breakpoint
DROP INDEX "pt_requests_client_status_idx";--> statement-breakpoint
DROP INDEX "pt_requests_location_status_idx";--> statement-breakpoint
DROP INDEX "pt_requests_class_type_idx";--> statement-breakpoint
DROP INDEX "pt_requests_expires_at_pending_idx";--> statement-breakpoint
DROP INDEX "pt_sessions_instructor_starts_idx";--> statement-breakpoint
DROP INDEX "pt_sessions_lifecycle_starts_idx";--> statement-breakpoint
DROP INDEX "pt_sessions_room_starts_idx";--> statement-breakpoint
DROP INDEX "workshop_days_starts_at_idx";--> statement-breakpoint
DROP INDEX "workshop_days_room_starts_idx";--> statement-breakpoint
DROP INDEX "workshop_images_workshop_ord_idx";--> statement-breakpoint
DROP INDEX "workshop_instructors_workshop_role_idx";--> statement-breakpoint
DROP INDEX "workshop_tier_days_day_idx";--> statement-breakpoint
DROP INDEX "workshop_tiers_workshop_ord_idx";--> statement-breakpoint
DROP INDEX "workshops_location_lifecycle_idx";--> statement-breakpoint
DROP INDEX "workshops_lifecycle_idx";--> statement-breakpoint
DROP INDEX "bookings_client_booked_idx";--> statement-breakpoint
DROP INDEX "bookings_class_state_idx";--> statement-breakpoint
DROP INDEX "bookings_tier_state_idx";--> statement-breakpoint
DROP INDEX "bookings_pt_session_idx";--> statement-breakpoint
DROP INDEX "bookings_check_in_state_idx";--> statement-breakpoint
DROP INDEX "cancellations_client_cancelled_idx";--> statement-breakpoint
DROP INDEX "audit_log_target_idx";--> statement-breakpoint
DROP INDEX "audit_log_actor_idx";--> statement-breakpoint
DROP INDEX "audit_log_action_idx";--> statement-breakpoint
DROP INDEX "manual_adjustments_client_created_idx";--> statement-breakpoint
DROP INDEX "manual_adjustments_package_idx";--> statement-breakpoint
DROP INDEX "stripe_payments_client_created_idx";--> statement-breakpoint
DROP INDEX "email_log_recipient_queued_idx";--> statement-breakpoint
DROP INDEX "email_log_status_idx";--> statement-breakpoint
DROP INDEX "email_log_template_queued_idx";--> statement-breakpoint
DROP INDEX "inbox_items_type_read_created_idx";--> statement-breakpoint
DROP INDEX "leave_requests_instructor_year_idx";--> statement-breakpoint
DROP INDEX "leave_requests_dates_idx";--> statement-breakpoint
DROP INDEX "leave_requests_status_idx";--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_invitations" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "staff_invitations" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_users" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "staff_users" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "class_types" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "class_types" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "instructor_class_types" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "instructor_class_types" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "instructors" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "instructors" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_conflicts" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "leave_conflicts" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "merch" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "merch" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "merch_orders" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "merch_orders" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "global_policy" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "global_policy" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_booking_config" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pt_booking_config" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "class_packages" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "class_packages" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "client_packages" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "client_packages" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_packages" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "corporate_packages" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_code_products" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "promo_code_products" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_code_redemptions" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "promo_code_redemptions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_codes" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "promotions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_packages" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pt_packages" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "class_supporting_instructors" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "class_supporting_instructors" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "classes" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_requests" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "corporate_requests" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_session_supporting_instructors" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "corporate_session_supporting_instructors" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "manual_payroll_entries" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "manual_payroll_entries" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_request_slots" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pt_request_slots" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_requests" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pt_requests" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_session_clients" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pt_session_clients" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_session_supporting_instructors" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pt_session_supporting_instructors" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_sessions" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pt_sessions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workshop_days" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workshop_days" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workshop_images" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workshop_images" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workshop_tier_days" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workshop_tier_days" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workshop_tiers" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workshop_tiers" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workshops" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workshops" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cancellations" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "cancellations" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "check_ins" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "check_ins" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "manual_adjustments" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "manual_adjustments" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_payments" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stripe_payments" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "email_log" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "email_log" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "email_templates" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "marketing_content" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "marketing_content" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "waiver" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "waiver" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_items" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "inbox_items" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_pools" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "leave_pools" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_requests" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "leave_requests" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_flags" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "clients_status_idx" ON "clients" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "clients_referrer_idx" ON "clients" USING btree ("tenant_id","referred_by_client_id");--> statement-breakpoint
CREATE INDEX "clients_name_lower_idx" ON "clients" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "clients_deleted_idx" ON "clients" USING btree ("tenant_id","deleted_at");--> statement-breakpoint
CREATE INDEX "staff_invitations_email_status_idx" ON "staff_invitations" USING btree ("tenant_id","email","status");--> statement-breakpoint
CREATE INDEX "staff_invitations_inviter_idx" ON "staff_invitations" USING btree ("tenant_id","invited_by_staff_id");--> statement-breakpoint
CREATE INDEX "staff_role_status_idx" ON "staff_users" USING btree ("tenant_id","role","status");--> statement-breakpoint
CREATE INDEX "staff_users_deleted_idx" ON "staff_users" USING btree ("tenant_id","deleted_at");--> statement-breakpoint
CREATE INDEX "class_types_archived_idx" ON "class_types" USING btree ("tenant_id","archived_at");--> statement-breakpoint
CREATE INDEX "class_types_deleted_idx" ON "class_types" USING btree ("tenant_id","deleted_at");--> statement-breakpoint
CREATE INDEX "class_types_name_lower_idx" ON "class_types" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "class_types_parent_idx" ON "class_types" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "locations_archived_idx" ON "locations" USING btree ("tenant_id","archived_at");--> statement-breakpoint
CREATE INDEX "locations_deleted_idx" ON "locations" USING btree ("tenant_id","deleted_at");--> statement-breakpoint
CREATE INDEX "merch_archived_idx" ON "merch" USING btree ("tenant_id","archived_at");--> statement-breakpoint
CREATE INDEX "merch_orders_client_created_idx" ON "merch_orders" USING btree ("tenant_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX "rooms_location_archived_idx" ON "rooms" USING btree ("tenant_id","location_id","archived_at");--> statement-breakpoint
CREATE INDEX "rooms_deleted_idx" ON "rooms" USING btree ("tenant_id","deleted_at");--> statement-breakpoint
CREATE INDEX "class_packages_status_kind_idx" ON "class_packages" USING btree ("tenant_id","status","kind");--> statement-breakpoint
CREATE INDEX "class_packages_deleted_idx" ON "class_packages" USING btree ("tenant_id","deleted_at");--> statement-breakpoint
CREATE INDEX "client_packages_client_kind_idx" ON "client_packages" USING btree ("tenant_id","client_id","kind");--> statement-breakpoint
CREATE INDEX "client_packages_client_expiry_idx" ON "client_packages" USING btree ("tenant_id","client_id","expires_at");--> statement-breakpoint
CREATE INDEX "corporate_packages_status_idx" ON "corporate_packages" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "corporate_packages_deleted_idx" ON "corporate_packages" USING btree ("tenant_id","deleted_at");--> statement-breakpoint
CREATE INDEX "promotions_parent_lookup_idx" ON "promotions" USING btree ("tenant_id","parent_type","parent_id","status","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "promotions_sort_idx" ON "promotions" USING btree ("tenant_id","sort_id");--> statement-breakpoint
CREATE INDEX "class_supporting_instructors_instructor_idx" ON "class_supporting_instructors" USING btree ("tenant_id","instructor_id");--> statement-breakpoint
CREATE INDEX "classes_starts_at_idx" ON "classes" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "classes_main_instructor_starts_idx" ON "classes" USING btree ("tenant_id","main_instructor_id","starts_at");--> statement-breakpoint
CREATE INDEX "classes_location_starts_idx" ON "classes" USING btree ("tenant_id","location_id","starts_at");--> statement-breakpoint
CREATE INDEX "classes_room_starts_idx" ON "classes" USING btree ("tenant_id","room_id","starts_at");--> statement-breakpoint
CREATE INDEX "classes_class_type_idx" ON "classes" USING btree ("tenant_id","class_type_id");--> statement-breakpoint
CREATE INDEX "classes_lifecycle_starts_idx" ON "classes" USING btree ("tenant_id","lifecycle","starts_at");--> statement-breakpoint
CREATE INDEX "corporate_requests_status_created_idx" ON "corporate_requests" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "corporate_requests_client_status_idx" ON "corporate_requests" USING btree ("tenant_id","client_id","status");--> statement-breakpoint
CREATE INDEX "corporate_session_supporting_instructors_instructor_idx" ON "corporate_session_supporting_instructors" USING btree ("tenant_id","instructor_id");--> statement-breakpoint
CREATE INDEX "corporate_sessions_starts_at_idx" ON "corporate_sessions" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "corporate_sessions_instructor_starts_idx" ON "corporate_sessions" USING btree ("tenant_id","main_instructor_id","starts_at");--> statement-breakpoint
CREATE INDEX "corporate_sessions_location_starts_idx" ON "corporate_sessions" USING btree ("tenant_id","location_id","starts_at");--> statement-breakpoint
CREATE INDEX "corporate_sessions_room_starts_idx" ON "corporate_sessions" USING btree ("tenant_id","room_id","starts_at");--> statement-breakpoint
CREATE INDEX "corporate_sessions_lifecycle_starts_idx" ON "corporate_sessions" USING btree ("tenant_id","lifecycle","starts_at");--> statement-breakpoint
CREATE INDEX "manual_payroll_entries_instructor_entry_date_idx" ON "manual_payroll_entries" USING btree ("tenant_id","instructor_id","entry_date");--> statement-breakpoint
CREATE INDEX "pt_request_slots_request_idx" ON "pt_request_slots" USING btree ("tenant_id","pt_request_id");--> statement-breakpoint
CREATE INDEX "pt_requests_status_created_idx" ON "pt_requests" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "pt_requests_client_status_idx" ON "pt_requests" USING btree ("tenant_id","client_id","status");--> statement-breakpoint
CREATE INDEX "pt_requests_location_status_idx" ON "pt_requests" USING btree ("tenant_id","location_id","status");--> statement-breakpoint
CREATE INDEX "pt_requests_class_type_idx" ON "pt_requests" USING btree ("tenant_id","class_type_id");--> statement-breakpoint
CREATE INDEX "pt_requests_expires_at_pending_idx" ON "pt_requests" USING btree ("tenant_id","expires_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "pt_sessions_instructor_starts_idx" ON "pt_sessions" USING btree ("tenant_id","instructor_id","starts_at");--> statement-breakpoint
CREATE INDEX "pt_sessions_lifecycle_starts_idx" ON "pt_sessions" USING btree ("tenant_id","lifecycle","starts_at");--> statement-breakpoint
CREATE INDEX "pt_sessions_room_starts_idx" ON "pt_sessions" USING btree ("tenant_id","room_id","starts_at");--> statement-breakpoint
CREATE INDEX "workshop_days_starts_at_idx" ON "workshop_days" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "workshop_days_room_starts_idx" ON "workshop_days" USING btree ("tenant_id","room_id","starts_at");--> statement-breakpoint
CREATE INDEX "workshop_images_workshop_ord_idx" ON "workshop_images" USING btree ("tenant_id","workshop_id","ord");--> statement-breakpoint
CREATE INDEX "workshop_instructors_workshop_role_idx" ON "workshop_instructors" USING btree ("tenant_id","workshop_id","role");--> statement-breakpoint
CREATE INDEX "workshop_tier_days_day_idx" ON "workshop_tier_days" USING btree ("tenant_id","workshop_day_id");--> statement-breakpoint
CREATE INDEX "workshop_tiers_workshop_ord_idx" ON "workshop_tiers" USING btree ("tenant_id","workshop_id","ord");--> statement-breakpoint
CREATE INDEX "workshops_location_lifecycle_idx" ON "workshops" USING btree ("tenant_id","location_id","lifecycle");--> statement-breakpoint
CREATE INDEX "workshops_lifecycle_idx" ON "workshops" USING btree ("tenant_id","lifecycle");--> statement-breakpoint
CREATE INDEX "bookings_client_booked_idx" ON "bookings" USING btree ("tenant_id","client_id","booked_at");--> statement-breakpoint
CREATE INDEX "bookings_class_state_idx" ON "bookings" USING btree ("tenant_id","class_id","state");--> statement-breakpoint
CREATE INDEX "bookings_tier_state_idx" ON "bookings" USING btree ("tenant_id","workshop_tier_id","state");--> statement-breakpoint
CREATE INDEX "bookings_pt_session_idx" ON "bookings" USING btree ("tenant_id","pt_session_id");--> statement-breakpoint
CREATE INDEX "bookings_check_in_state_idx" ON "bookings" USING btree ("tenant_id","check_in_state");--> statement-breakpoint
CREATE INDEX "cancellations_client_cancelled_idx" ON "cancellations" USING btree ("tenant_id","client_id","cancelled_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("tenant_id","target_table","target_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("tenant_id","actor_staff_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("tenant_id","action","created_at");--> statement-breakpoint
CREATE INDEX "manual_adjustments_client_created_idx" ON "manual_adjustments" USING btree ("tenant_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX "manual_adjustments_package_idx" ON "manual_adjustments" USING btree ("tenant_id","client_package_id");--> statement-breakpoint
CREATE INDEX "stripe_payments_client_created_idx" ON "stripe_payments" USING btree ("tenant_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX "email_log_recipient_queued_idx" ON "email_log" USING btree ("tenant_id","recipient_user_id","queued_at");--> statement-breakpoint
CREATE INDEX "email_log_status_idx" ON "email_log" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "email_log_template_queued_idx" ON "email_log" USING btree ("tenant_id","template_slug","queued_at");--> statement-breakpoint
CREATE INDEX "inbox_items_type_read_created_idx" ON "inbox_items" USING btree ("tenant_id","type","read_at","created_at");--> statement-breakpoint
CREATE INDEX "leave_requests_instructor_year_idx" ON "leave_requests" USING btree ("tenant_id","instructor_id","leave_year");--> statement-breakpoint
CREATE INDEX "leave_requests_dates_idx" ON "leave_requests" USING btree ("tenant_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "leave_requests_status_idx" ON "leave_requests" USING btree ("tenant_id","status");