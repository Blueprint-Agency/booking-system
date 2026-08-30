CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"logo_url" text,
	"favicon_url" text,
	"og_image_url" text,
	"tagline" text,
	"copy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mail_from_name" text,
	"mail_from_email" text,
	"mail_reply_to" text,
	"waiver_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Singapore' NOT NULL,
	"clerk_client_org_id" text,
	"clerk_portal_org_id" text,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_clerk_client_org_id_unique" UNIQUE("clerk_client_org_id"),
	CONSTRAINT "tenants_clerk_portal_org_id_unique" UNIQUE("clerk_portal_org_id")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "class_types" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "instructor_class_types" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_conflicts" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "merch" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "merch_orders" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "global_policy" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "pt_booking_config" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "class_packages" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "corporate_packages" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "promo_code_products" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "promo_code_redemptions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "pt_packages" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "class_supporting_instructors" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "corporate_requests" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "corporate_session_supporting_instructors" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "manual_payroll_entries" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "pt_request_slots" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "pt_session_clients" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "pt_session_supporting_instructors" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "pt_sessions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "workshop_days" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "workshop_images" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "workshop_tier_days" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "workshop_tiers" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "workshops" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "cancellations" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "check_ins" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "manual_adjustments" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "stripe_payments" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "marketing_content" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "waiver" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_pools" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_types" ADD CONSTRAINT "class_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_class_types" ADD CONSTRAINT "instructor_class_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_conflicts" ADD CONSTRAINT "leave_conflicts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch" ADD CONSTRAINT "merch_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_orders" ADD CONSTRAINT "merch_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_policy" ADD CONSTRAINT "global_policy_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_booking_config" ADD CONSTRAINT "pt_booking_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_packages" ADD CONSTRAINT "class_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_packages" ADD CONSTRAINT "corporate_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_products" ADD CONSTRAINT "promo_code_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_packages" ADD CONSTRAINT "pt_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_supporting_instructors" ADD CONSTRAINT "class_supporting_instructors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_requests" ADD CONSTRAINT "corporate_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_session_supporting_instructors" ADD CONSTRAINT "corporate_session_supporting_instructors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_payroll_entries" ADD CONSTRAINT "manual_payroll_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_request_slots" ADD CONSTRAINT "pt_request_slots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD CONSTRAINT "pt_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_session_clients" ADD CONSTRAINT "pt_session_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_session_supporting_instructors" ADD CONSTRAINT "pt_session_supporting_instructors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_sessions" ADD CONSTRAINT "pt_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_days" ADD CONSTRAINT "workshop_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_images" ADD CONSTRAINT "workshop_images_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ADD CONSTRAINT "workshop_instructors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_tier_days" ADD CONSTRAINT "workshop_tier_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_tiers" ADD CONSTRAINT "workshop_tiers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_payments" ADD CONSTRAINT "stripe_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content" ADD CONSTRAINT "marketing_content_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver" ADD CONSTRAINT "waiver_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_pools" ADD CONSTRAINT "leave_pools_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;