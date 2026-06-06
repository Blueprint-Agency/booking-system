CREATE TYPE "public"."audit_actor_type" AS ENUM('staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."booking_kind" AS ENUM('class', 'workshop', 'pt');--> statement-breakpoint
CREATE TYPE "public"."booking_state" AS ENUM('confirmed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."cancellation_kind" AS ENUM('class', 'pt');--> statement-breakpoint
CREATE TYPE "public"."cancellation_source" AS ENUM('client', 'admin');--> statement-breakpoint
CREATE TYPE "public"."checkin_method" AS ENUM('qr', 'code', 'manual');--> statement-breakpoint
CREATE TYPE "public"."checkin_state" AS ENUM('pending', 'attended', 'no_show', 'n_a');--> statement-breakpoint
CREATE TYPE "public"."class_package_kind" AS ENUM('credit_bundle', 'unlimited', 'trial');--> statement-breakpoint
CREATE TYPE "public"."client_gender" AS ENUM('female', 'male', 'non_binary', 'prefer_not_to_say');--> statement-breakpoint
CREATE TYPE "public"."client_package_kind" AS ENUM('credit_bundle', 'unlimited', 'trial', 'pt');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."corporate_request_status" AS ENUM('pending', 'scheduled', 'cancelled', 'attended');--> statement-breakpoint
CREATE TYPE "public"."email_log_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_recipient_kind" AS ENUM('client', 'staff');--> statement-breakpoint
CREATE TYPE "public"."inbox_item_type" AS ENUM('client_cancellation', 'admin_cancel_class_pt', 'admin_cancel_workshop');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."lifecycle" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."package_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."promotion_kind" AS ENUM('percent', 'special_price');--> statement-breakpoint
CREATE TYPE "public"."promotion_parent" AS ENUM('class_package', 'pt_package', 'workshop');--> statement-breakpoint
CREATE TYPE "public"."promotion_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."pt_request_status" AS ENUM('pending', 'scheduled', 'cancelled_before_scheduled', 'cancelled_after_scheduled', 'attended');--> statement-breakpoint
CREATE TYPE "public"."pt_session_type" AS ENUM('1on1', '2on1');--> statement-breakpoint
CREATE TYPE "public"."refund_outcome" AS ENUM('credit_returned', 'session_returned', 'stripe_refunded', 'forfeited', 'n_a');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('superadmin', 'admin', 'instructor');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('pending', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."stripe_payment_kind" AS ENUM('workshop', 'class_package', 'pt_package', 'corporate_package');--> statement-breakpoint
CREATE TYPE "public"."stripe_payment_status" AS ENUM('pending', 'succeeded', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workshop_instructor_role" AS ENUM('main', 'supporting');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"gender" "client_gender",
	"dob" date,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"suspended_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by_staff_id" uuid,
	"referred_by_client_id" uuid,
	"referral_credit_granted_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "clients_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"granted_location_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by_staff_id" uuid NOT NULL,
	"staff_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "staff_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"status" "staff_status" DEFAULT 'pending' NOT NULL,
	"granted_location_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_staff_id" uuid,
	"deleted_at" timestamp with time zone,
	"invited_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "staff_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "class_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" uuid,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "instructor_class_types" (
	"instructor_id" uuid NOT NULL,
	"class_type_id" uuid NOT NULL,
	CONSTRAINT "instructor_class_types_instructor_id_class_type_id_pk" PRIMARY KEY("instructor_id","class_type_id")
);
--> statement-breakpoint
CREATE TABLE "instructors" (
	"staff_user_id" uuid PRIMARY KEY NOT NULL,
	"photo_r2_key" text,
	"bio" text,
	"phone" text
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"gmaps_url" text,
	"phone" text,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "rooms_capacity_positive" CHECK ("rooms"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "global_policy" (
	"id" uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
	"cancel_cap_count" integer NOT NULL,
	"cancel_cap_cycle_days" integer NOT NULL,
	"class_window_hours" integer NOT NULL,
	"pt_window_hours" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_staff_id" uuid,
	CONSTRAINT "global_policy_singleton" CHECK ("global_policy"."id" = '00000000-0000-0000-0000-000000000001'::uuid)
);
--> statement-breakpoint
CREATE TABLE "pt_booking_config" (
	"id" uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000002'::uuid NOT NULL,
	"book_in_advance_days" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_staff_id" uuid,
	CONSTRAINT "pt_booking_config_singleton" CHECK ("pt_booking_config"."id" = '00000000-0000-0000-0000-000000000002'::uuid)
);
--> statement-breakpoint
CREATE TABLE "class_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" "class_package_kind" NOT NULL,
	"credits" integer,
	"validity_days" integer,
	"duration_days" integer,
	"price_sgd" numeric(10, 2) NOT NULL,
	"status" "package_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "class_packages_kind_fields" CHECK (
        ("class_packages"."kind" = 'credit_bundle'
          AND "class_packages"."credits" IS NOT NULL
          AND "class_packages"."validity_days" IS NOT NULL
          AND "class_packages"."duration_days" IS NULL)
        OR
        ("class_packages"."kind" = 'unlimited'
          AND "class_packages"."credits" IS NULL
          AND "class_packages"."validity_days" IS NULL
          AND "class_packages"."duration_days" IS NOT NULL)
        OR
        ("class_packages"."kind" = 'trial'
          AND "class_packages"."credits" IS NOT NULL
          AND "class_packages"."duration_days" IS NULL)
      )
);
--> statement-breakpoint
CREATE TABLE "client_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "client_package_kind" NOT NULL,
	"source_class_package_id" uuid,
	"source_pt_package_id" uuid,
	"applied_promotion_id" uuid,
	"credits_or_sessions_remaining" integer,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount_paid_sgd" numeric(10, 2) NOT NULL,
	"stripe_payment_intent_id" text,
	CONSTRAINT "client_packages_non_negative_balance" CHECK ("client_packages"."credits_or_sessions_remaining" IS NULL OR "client_packages"."credits_or_sessions_remaining" >= 0)
);
--> statement-breakpoint
CREATE TABLE "corporate_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_sgd" numeric(10, 2) NOT NULL,
	"status" "package_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	CONSTRAINT "corporate_packages_price_positive" CHECK ("corporate_packages"."price_sgd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_type" "promotion_parent" NOT NULL,
	"parent_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" "promotion_kind" NOT NULL,
	"percent_off" integer,
	"special_price_sgd" numeric(10, 2),
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "promotion_status" DEFAULT 'active' NOT NULL,
	"sort_id" bigserial NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	CONSTRAINT "promotions_ends_after_starts" CHECK ("promotions"."ends_at" > "promotions"."starts_at"),
	CONSTRAINT "promotions_kind_fields" CHECK (
        ("promotions"."kind" = 'percent'
          AND "promotions"."percent_off" IS NOT NULL
          AND "promotions"."percent_off" BETWEEN 1 AND 99
          AND "promotions"."special_price_sgd" IS NULL)
        OR
        ("promotions"."kind" = 'special_price'
          AND "promotions"."special_price_sgd" IS NOT NULL
          AND "promotions"."percent_off" IS NULL)
      )
);
--> statement-breakpoint
CREATE TABLE "pt_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"session_type" "pt_session_type" NOT NULL,
	"num_sessions" integer NOT NULL,
	"price_sgd" numeric(10, 2) NOT NULL,
	"status" "package_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "class_supporting_instructors" (
	"class_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	CONSTRAINT "class_supporting_instructors_class_id_instructor_id_pk" PRIMARY KEY("class_id","instructor_id")
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_type_id" uuid NOT NULL,
	"main_instructor_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"room_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity_online" integer NOT NULL,
	"capacity_waitlist" integer DEFAULT 0 NOT NULL,
	"capacity_buffer" integer DEFAULT 0 NOT NULL,
	"credit_cost" integer NOT NULL,
	"lifecycle" "lifecycle" DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	CONSTRAINT "classes_ends_after_starts" CHECK ("classes"."ends_at" > "classes"."starts_at"),
	CONSTRAINT "classes_capacity_online_non_negative" CHECK ("classes"."capacity_online" >= 0),
	CONSTRAINT "classes_capacity_waitlist_non_negative" CHECK ("classes"."capacity_waitlist" >= 0),
	CONSTRAINT "classes_capacity_buffer_non_negative" CHECK ("classes"."capacity_buffer" >= 0),
	CONSTRAINT "classes_capacity_sum_positive" CHECK ("classes"."capacity_online" + "classes"."capacity_waitlist" + "classes"."capacity_buffer" > 0),
	CONSTRAINT "classes_credit_non_negative" CHECK ("classes"."credit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "corporate_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"corporate_package_id" uuid NOT NULL,
	"status" "corporate_request_status" DEFAULT 'pending' NOT NULL,
	"message" text,
	"scheduled_corporate_session_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporate_session_supporting_instructors" (
	"corporate_session_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	CONSTRAINT "corporate_session_supporting_instructors_corporate_session_id_instructor_id_pk" PRIMARY KEY("corporate_session_id","instructor_id")
);
--> statement-breakpoint
CREATE TABLE "corporate_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporate_package_id" uuid NOT NULL,
	"corporate_request_id" uuid,
	"client_name" text NOT NULL,
	"main_instructor_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"lifecycle" "lifecycle" DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	CONSTRAINT "corporate_sessions_ends_after_starts" CHECK ("corporate_sessions"."ends_at" > "corporate_sessions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "pt_request_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pt_request_id" uuid NOT NULL,
	"proposed_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	CONSTRAINT "pt_request_slots_end_after_start" CHECK ("pt_request_slots"."end_time" > "pt_request_slots"."start_time")
);
--> statement-breakpoint
CREATE TABLE "pt_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"class_type_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"session_type" "pt_session_type" NOT NULL,
	"co_client_id" uuid,
	"co_client_name" text,
	"co_client_email" text,
	"message" text,
	"status" "pt_request_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scheduled_pt_session_id" uuid,
	"debited_client_package_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pt_session_clients" (
	"pt_session_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	CONSTRAINT "pt_session_clients_pt_session_id_client_id_pk" PRIMARY KEY("pt_session_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "pt_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pt_request_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"room_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"session_type" "pt_session_type" NOT NULL,
	"capacity_online" integer NOT NULL,
	"capacity_waitlist" integer DEFAULT 0 NOT NULL,
	"capacity_buffer" integer DEFAULT 0 NOT NULL,
	"lifecycle" "lifecycle" DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_staff_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"scheduled_by_staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pt_sessions_ends_after_starts" CHECK ("pt_sessions"."ends_at" > "pt_sessions"."starts_at"),
	CONSTRAINT "pt_sessions_capacity_online_non_negative" CHECK ("pt_sessions"."capacity_online" >= 0),
	CONSTRAINT "pt_sessions_capacity_waitlist_non_negative" CHECK ("pt_sessions"."capacity_waitlist" >= 0),
	CONSTRAINT "pt_sessions_capacity_buffer_non_negative" CHECK ("pt_sessions"."capacity_buffer" >= 0),
	CONSTRAINT "pt_sessions_capacity_sum_positive" CHECK ("pt_sessions"."capacity_online" + "pt_sessions"."capacity_waitlist" + "pt_sessions"."capacity_buffer" > 0)
);
--> statement-breakpoint
CREATE TABLE "workshop_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workshop_id" uuid NOT NULL,
	"ord" integer NOT NULL,
	"room_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"base_price_sgd" numeric(10, 2) NOT NULL,
	"capacity_online" integer NOT NULL,
	"capacity_waitlist" integer DEFAULT 0 NOT NULL,
	"capacity_buffer" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "workshop_days_ends_after_starts" CHECK ("workshop_days"."ends_at" > "workshop_days"."starts_at"),
	CONSTRAINT "workshop_days_capacity_online_non_negative" CHECK ("workshop_days"."capacity_online" >= 0),
	CONSTRAINT "workshop_days_capacity_waitlist_non_negative" CHECK ("workshop_days"."capacity_waitlist" >= 0),
	CONSTRAINT "workshop_days_capacity_buffer_non_negative" CHECK ("workshop_days"."capacity_buffer" >= 0),
	CONSTRAINT "workshop_days_capacity_sum_positive" CHECK ("workshop_days"."capacity_online" + "workshop_days"."capacity_waitlist" + "workshop_days"."capacity_buffer" > 0)
);
--> statement-breakpoint
CREATE TABLE "workshop_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workshop_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"ord" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workshop_instructors" (
	"workshop_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"role" "workshop_instructor_role" NOT NULL,
	CONSTRAINT "workshop_instructors_workshop_id_instructor_id_pk" PRIMARY KEY("workshop_id","instructor_id")
);
--> statement-breakpoint
CREATE TABLE "workshop_tier_days" (
	"workshop_tier_id" uuid NOT NULL,
	"workshop_day_id" uuid NOT NULL,
	CONSTRAINT "workshop_tier_days_workshop_tier_id_workshop_day_id_pk" PRIMARY KEY("workshop_tier_id","workshop_day_id")
);
--> statement-breakpoint
CREATE TABLE "workshop_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workshop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"regular_price_sgd" numeric(10, 2) NOT NULL,
	"early_bird_price_sgd" numeric(10, 2),
	"early_bird_quota" integer,
	"early_bird_cutoff_at" timestamp with time zone,
	"ord" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workshops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cover_r2_key" text,
	"description_html" text,
	"location_id" uuid NOT NULL,
	"lifecycle" "lifecycle" DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_staff_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "booking_kind" NOT NULL,
	"class_id" uuid,
	"workshop_id" uuid,
	"workshop_tier_id" uuid,
	"pt_session_id" uuid,
	"client_package_id" uuid,
	"applied_promotion_id" uuid,
	"state" "booking_state" DEFAULT 'confirmed' NOT NULL,
	"credits_or_sessions_used" integer,
	"refund_outcome" "refund_outcome" DEFAULT 'n_a' NOT NULL,
	"check_in_state" "checkin_state" DEFAULT 'pending' NOT NULL,
	"qr_token" text NOT NULL,
	"code" text NOT NULL,
	"stripe_payment_intent_id" text,
	"booked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "bookings_kind_class_fk" CHECK ("bookings"."kind" <> 'class' OR ("bookings"."class_id" IS NOT NULL AND "bookings"."workshop_id" IS NULL AND "bookings"."pt_session_id" IS NULL)),
	CONSTRAINT "bookings_kind_workshop_fk" CHECK ("bookings"."kind" <> 'workshop' OR ("bookings"."workshop_id" IS NOT NULL AND "bookings"."workshop_tier_id" IS NOT NULL AND "bookings"."class_id" IS NULL AND "bookings"."pt_session_id" IS NULL)),
	CONSTRAINT "bookings_kind_pt_fk" CHECK ("bookings"."kind" <> 'pt' OR ("bookings"."pt_session_id" IS NOT NULL AND "bookings"."class_id" IS NULL AND "bookings"."workshop_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "cancellation_kind" NOT NULL,
	"source" "cancellation_source" NOT NULL,
	"was_within_window" boolean NOT NULL,
	"was_within_cap" boolean NOT NULL,
	"refund_fired" boolean NOT NULL,
	"cancelled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_in_by_staff_id" uuid NOT NULL,
	"method" "checkin_method" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_staff_id" uuid,
	"actor_type" "audit_actor_type" NOT NULL,
	"action" text NOT NULL,
	"target_table" text NOT NULL,
	"target_id" uuid NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"client_package_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"acted_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_intent_id" text NOT NULL,
	"amount_sgd" numeric(10, 2) NOT NULL,
	"kind" "stripe_payment_kind" NOT NULL,
	"client_id" uuid NOT NULL,
	"booking_id" uuid,
	"client_package_id" uuid,
	"status" "stripe_payment_status" DEFAULT 'pending' NOT NULL,
	"receipt_url" text,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_payments_payment_intent_id_unique" UNIQUE("payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_slug" text NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_user_id" uuid,
	"recipient_user_kind" "email_recipient_kind" NOT NULL,
	"subject_rendered" text NOT NULL,
	"body_rendered" text NOT NULL,
	"status" "email_log_status" DEFAULT 'queued' NOT NULL,
	"smtp_message_id" text,
	"smtp_response" text,
	"error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_staff_id" uuid,
	CONSTRAINT "email_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "marketing_content" (
	"id" uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000004'::uuid NOT NULL,
	"hero_heading" text NOT NULL,
	"hero_subheading" text NOT NULL,
	"pricing_blurb" text,
	"testimonials" jsonb,
	"footer_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_staff_id" uuid,
	CONSTRAINT "marketing_content_singleton" CHECK ("marketing_content"."id" = '00000000-0000-0000-0000-000000000004'::uuid)
);
--> statement-breakpoint
CREATE TABLE "waiver" (
	"id" uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000003'::uuid NOT NULL,
	"body_html" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_staff_id" uuid,
	CONSTRAINT "waiver_singleton" CHECK ("waiver"."id" = '00000000-0000-0000-0000-000000000003'::uuid)
);
--> statement-breakpoint
CREATE TABLE "waiver_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "inbox_item_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"read_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_staff_id" uuid
);
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_referrer_fk" FOREIGN KEY ("referred_by_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_staff_id_staff_users_id_fk" FOREIGN KEY ("invited_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_archiver_fk" FOREIGN KEY ("archived_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_types" ADD CONSTRAINT "class_types_parent_id_class_types_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."class_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_class_types" ADD CONSTRAINT "instructor_class_types_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_class_types" ADD CONSTRAINT "instructor_class_types_class_type_id_class_types_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_policy" ADD CONSTRAINT "global_policy_updated_by_staff_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_booking_config" ADD CONSTRAINT "pt_booking_config_updated_by_staff_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_source_class_package_id_class_packages_id_fk" FOREIGN KEY ("source_class_package_id") REFERENCES "public"."class_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_source_pt_package_id_pt_packages_id_fk" FOREIGN KEY ("source_pt_package_id") REFERENCES "public"."pt_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_applied_promotion_id_promotions_id_fk" FOREIGN KEY ("applied_promotion_id") REFERENCES "public"."promotions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_packages" ADD CONSTRAINT "corporate_packages_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_supporting_instructors" ADD CONSTRAINT "class_supporting_instructors_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_supporting_instructors" ADD CONSTRAINT "class_supporting_instructors_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_class_type_id_class_types_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_main_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("main_instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_cancelled_by_staff_id_staff_users_id_fk" FOREIGN KEY ("cancelled_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_requests" ADD CONSTRAINT "corporate_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_requests" ADD CONSTRAINT "corporate_requests_corporate_package_id_corporate_packages_id_fk" FOREIGN KEY ("corporate_package_id") REFERENCES "public"."corporate_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_requests" ADD CONSTRAINT "corporate_requests_resolved_by_staff_id_staff_users_id_fk" FOREIGN KEY ("resolved_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_session_supporting_instructors" ADD CONSTRAINT "corporate_session_supporting_instructors_corporate_session_id_corporate_sessions_id_fk" FOREIGN KEY ("corporate_session_id") REFERENCES "public"."corporate_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_session_supporting_instructors" ADD CONSTRAINT "corporate_session_supporting_instructors_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_corporate_package_id_corporate_packages_id_fk" FOREIGN KEY ("corporate_package_id") REFERENCES "public"."corporate_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_main_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("main_instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_cancelled_by_staff_id_staff_users_id_fk" FOREIGN KEY ("cancelled_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_request_slots" ADD CONSTRAINT "pt_request_slots_pt_request_id_pt_requests_id_fk" FOREIGN KEY ("pt_request_id") REFERENCES "public"."pt_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD CONSTRAINT "pt_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD CONSTRAINT "pt_requests_class_type_id_class_types_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD CONSTRAINT "pt_requests_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD CONSTRAINT "pt_requests_co_client_id_clients_id_fk" FOREIGN KEY ("co_client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD CONSTRAINT "pt_requests_debited_client_package_id_client_packages_id_fk" FOREIGN KEY ("debited_client_package_id") REFERENCES "public"."client_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD CONSTRAINT "pt_requests_resolved_by_staff_id_staff_users_id_fk" FOREIGN KEY ("resolved_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_session_clients" ADD CONSTRAINT "pt_session_clients_pt_session_id_pt_sessions_id_fk" FOREIGN KEY ("pt_session_id") REFERENCES "public"."pt_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_session_clients" ADD CONSTRAINT "pt_session_clients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_sessions" ADD CONSTRAINT "pt_sessions_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_sessions" ADD CONSTRAINT "pt_sessions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_sessions" ADD CONSTRAINT "pt_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_sessions" ADD CONSTRAINT "pt_sessions_cancelled_by_staff_id_staff_users_id_fk" FOREIGN KEY ("cancelled_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_sessions" ADD CONSTRAINT "pt_sessions_scheduled_by_staff_id_staff_users_id_fk" FOREIGN KEY ("scheduled_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_sessions" ADD CONSTRAINT "pt_sessions_pt_request_fk" FOREIGN KEY ("pt_request_id") REFERENCES "public"."pt_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_days" ADD CONSTRAINT "workshop_days_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_days" ADD CONSTRAINT "workshop_days_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_images" ADD CONSTRAINT "workshop_images_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ADD CONSTRAINT "workshop_instructors_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ADD CONSTRAINT "workshop_instructors_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_tier_days" ADD CONSTRAINT "workshop_tier_days_workshop_tier_id_workshop_tiers_id_fk" FOREIGN KEY ("workshop_tier_id") REFERENCES "public"."workshop_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_tier_days" ADD CONSTRAINT "workshop_tier_days_workshop_day_id_workshop_days_id_fk" FOREIGN KEY ("workshop_day_id") REFERENCES "public"."workshop_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_tiers" ADD CONSTRAINT "workshop_tiers_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_cancelled_by_staff_id_staff_users_id_fk" FOREIGN KEY ("cancelled_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_workshop_tier_id_workshop_tiers_id_fk" FOREIGN KEY ("workshop_tier_id") REFERENCES "public"."workshop_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pt_session_id_pt_sessions_id_fk" FOREIGN KEY ("pt_session_id") REFERENCES "public"."pt_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_package_id_client_packages_id_fk" FOREIGN KEY ("client_package_id") REFERENCES "public"."client_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_applied_promotion_id_promotions_id_fk" FOREIGN KEY ("applied_promotion_id") REFERENCES "public"."promotions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_checked_in_by_staff_id_staff_users_id_fk" FOREIGN KEY ("checked_in_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_staff_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_client_package_id_client_packages_id_fk" FOREIGN KEY ("client_package_id") REFERENCES "public"."client_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_adjustments" ADD CONSTRAINT "manual_adjustments_acted_by_staff_id_staff_users_id_fk" FOREIGN KEY ("acted_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_payments" ADD CONSTRAINT "stripe_payments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_payments" ADD CONSTRAINT "stripe_payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_payments" ADD CONSTRAINT "stripe_payments_client_package_id_client_packages_id_fk" FOREIGN KEY ("client_package_id") REFERENCES "public"."client_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_updated_by_staff_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_content" ADD CONSTRAINT "marketing_content_updated_by_staff_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver" ADD CONSTRAINT "waiver_updated_by_staff_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_read_by_staff_id_staff_users_id_fk" FOREIGN KEY ("read_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_staff_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_status_idx" ON "clients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clients_referrer_idx" ON "clients" USING btree ("referred_by_client_id");--> statement-breakpoint
CREATE INDEX "clients_name_lower_idx" ON "clients" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "clients_deleted_idx" ON "clients" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "staff_invitations_email_status_idx" ON "staff_invitations" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX "staff_invitations_inviter_idx" ON "staff_invitations" USING btree ("invited_by_staff_id");--> statement-breakpoint
CREATE INDEX "staff_role_status_idx" ON "staff_users" USING btree ("role","status");--> statement-breakpoint
CREATE INDEX "staff_users_deleted_idx" ON "staff_users" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "staff_users_granted_locations_gin_idx" ON "staff_users" USING gin ("granted_location_ids");--> statement-breakpoint
CREATE INDEX "class_types_archived_idx" ON "class_types" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "class_types_deleted_idx" ON "class_types" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "class_types_name_lower_idx" ON "class_types" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "class_types_parent_idx" ON "class_types" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "locations_archived_idx" ON "locations" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "locations_deleted_idx" ON "locations" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "rooms_location_archived_idx" ON "rooms" USING btree ("location_id","archived_at");--> statement-breakpoint
CREATE INDEX "rooms_deleted_idx" ON "rooms" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_location_name_lower_unique" ON "rooms" USING btree ("location_id",lower("name"));--> statement-breakpoint
CREATE INDEX "class_packages_status_kind_idx" ON "class_packages" USING btree ("status","kind");--> statement-breakpoint
CREATE INDEX "class_packages_deleted_idx" ON "class_packages" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "client_packages_client_kind_idx" ON "client_packages" USING btree ("client_id","kind");--> statement-breakpoint
CREATE INDEX "client_packages_client_expiry_idx" ON "client_packages" USING btree ("client_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_packages_stripe_intent_unique" ON "client_packages" USING btree ("stripe_payment_intent_id") WHERE "client_packages"."stripe_payment_intent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "client_packages_trial_unique_per_client" ON "client_packages" USING btree ("client_id") WHERE "client_packages"."kind" = 'trial';--> statement-breakpoint
CREATE INDEX "corporate_packages_status_idx" ON "corporate_packages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "corporate_packages_deleted_idx" ON "corporate_packages" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "promotions_parent_lookup_idx" ON "promotions" USING btree ("parent_type","parent_id","status","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "promotions_sort_idx" ON "promotions" USING btree ("sort_id");--> statement-breakpoint
CREATE INDEX "class_supporting_instructors_instructor_idx" ON "class_supporting_instructors" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "classes_starts_at_idx" ON "classes" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "classes_main_instructor_starts_idx" ON "classes" USING btree ("main_instructor_id","starts_at");--> statement-breakpoint
CREATE INDEX "classes_location_starts_idx" ON "classes" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "classes_room_starts_idx" ON "classes" USING btree ("room_id","starts_at");--> statement-breakpoint
CREATE INDEX "classes_class_type_idx" ON "classes" USING btree ("class_type_id");--> statement-breakpoint
CREATE INDEX "classes_lifecycle_starts_idx" ON "classes" USING btree ("lifecycle","starts_at");--> statement-breakpoint
CREATE INDEX "corporate_requests_status_created_idx" ON "corporate_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "corporate_requests_client_status_idx" ON "corporate_requests" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "corporate_session_supporting_instructors_instructor_idx" ON "corporate_session_supporting_instructors" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "corporate_sessions_starts_at_idx" ON "corporate_sessions" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "corporate_sessions_instructor_starts_idx" ON "corporate_sessions" USING btree ("main_instructor_id","starts_at");--> statement-breakpoint
CREATE INDEX "corporate_sessions_location_starts_idx" ON "corporate_sessions" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "corporate_sessions_room_starts_idx" ON "corporate_sessions" USING btree ("room_id","starts_at");--> statement-breakpoint
CREATE INDEX "corporate_sessions_lifecycle_starts_idx" ON "corporate_sessions" USING btree ("lifecycle","starts_at");--> statement-breakpoint
CREATE INDEX "pt_request_slots_request_idx" ON "pt_request_slots" USING btree ("pt_request_id");--> statement-breakpoint
CREATE INDEX "pt_requests_status_created_idx" ON "pt_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "pt_requests_client_status_idx" ON "pt_requests" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "pt_requests_location_status_idx" ON "pt_requests" USING btree ("location_id","status");--> statement-breakpoint
CREATE INDEX "pt_requests_class_type_idx" ON "pt_requests" USING btree ("class_type_id");--> statement-breakpoint
CREATE INDEX "pt_requests_expires_at_pending_idx" ON "pt_requests" USING btree ("expires_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "pt_sessions_instructor_starts_idx" ON "pt_sessions" USING btree ("instructor_id","starts_at");--> statement-breakpoint
CREATE INDEX "pt_sessions_lifecycle_starts_idx" ON "pt_sessions" USING btree ("lifecycle","starts_at");--> statement-breakpoint
CREATE INDEX "pt_sessions_room_starts_idx" ON "pt_sessions" USING btree ("room_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pt_sessions_pt_request_unique" ON "pt_sessions" USING btree ("pt_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workshop_days_workshop_ord_unique" ON "workshop_days" USING btree ("workshop_id","ord");--> statement-breakpoint
CREATE INDEX "workshop_days_starts_at_idx" ON "workshop_days" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "workshop_days_room_starts_idx" ON "workshop_days" USING btree ("room_id","starts_at");--> statement-breakpoint
CREATE INDEX "workshop_images_workshop_ord_idx" ON "workshop_images" USING btree ("workshop_id","ord");--> statement-breakpoint
CREATE UNIQUE INDEX "workshop_instructors_main_unique" ON "workshop_instructors" USING btree ("workshop_id") WHERE role = 'main';--> statement-breakpoint
CREATE INDEX "workshop_instructors_workshop_role_idx" ON "workshop_instructors" USING btree ("workshop_id","role");--> statement-breakpoint
CREATE INDEX "workshop_tier_days_day_idx" ON "workshop_tier_days" USING btree ("workshop_day_id");--> statement-breakpoint
CREATE INDEX "workshop_tiers_workshop_ord_idx" ON "workshop_tiers" USING btree ("workshop_id","ord");--> statement-breakpoint
CREATE INDEX "workshops_location_lifecycle_idx" ON "workshops" USING btree ("location_id","lifecycle");--> statement-breakpoint
CREATE INDEX "workshops_lifecycle_idx" ON "workshops" USING btree ("lifecycle");--> statement-breakpoint
CREATE INDEX "bookings_client_booked_idx" ON "bookings" USING btree ("client_id","booked_at");--> statement-breakpoint
CREATE INDEX "bookings_class_state_idx" ON "bookings" USING btree ("class_id","state");--> statement-breakpoint
CREATE INDEX "bookings_tier_state_idx" ON "bookings" USING btree ("workshop_tier_id","state");--> statement-breakpoint
CREATE INDEX "bookings_pt_session_idx" ON "bookings" USING btree ("pt_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_qr_token_unique" ON "bookings" USING btree ("qr_token");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_code_unique" ON "bookings" USING btree ("code");--> statement-breakpoint
CREATE INDEX "bookings_check_in_state_idx" ON "bookings" USING btree ("check_in_state");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_stripe_intent_unique" ON "bookings" USING btree ("stripe_payment_intent_id") WHERE "bookings"."stripe_payment_intent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cancellations_client_cancelled_idx" ON "cancellations" USING btree ("client_id","cancelled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_booking_unique" ON "check_ins" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_table","target_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_staff_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "manual_adjustments_client_created_idx" ON "manual_adjustments" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "manual_adjustments_package_idx" ON "manual_adjustments" USING btree ("client_package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_payments_intent_unique" ON "stripe_payments" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "stripe_payments_client_created_idx" ON "stripe_payments" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "email_log_recipient_queued_idx" ON "email_log" USING btree ("recipient_user_id","queued_at");--> statement-breakpoint
CREATE INDEX "email_log_status_idx" ON "email_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_log_template_queued_idx" ON "email_log" USING btree ("template_slug","queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_signatures_client_unique" ON "waiver_signatures" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "inbox_items_type_read_created_idx" ON "inbox_items" USING btree ("type","read_at","created_at");