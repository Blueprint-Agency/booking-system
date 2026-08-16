CREATE TYPE "public"."promo_code_kind" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TYPE "public"."promo_code_product" AS ENUM('class_package', 'pt_package', 'workshop');--> statement-breakpoint
CREATE TYPE "public"."promo_code_redemption_status" AS ENUM('held', 'consumed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."promo_code_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "promo_code_products" (
	"promo_code_id" uuid NOT NULL,
	"product_type" "promo_code_product" NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "promo_code_products_pkey" PRIMARY KEY("promo_code_id","product_type","product_id")
);
--> statement-breakpoint
CREATE TABLE "promo_code_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" "promo_code_redemption_status" NOT NULL,
	"held_until" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"stripe_payment_intent_id" text,
	"discount_sgd" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" "promo_code_kind" NOT NULL,
	"percent_off" integer,
	"amount_off_sgd" numeric(10, 2),
	"max_redemptions" integer,
	"expires_at" timestamp with time zone,
	"applies_to_all" boolean DEFAULT false NOT NULL,
	"status" "promo_code_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	CONSTRAINT "promo_codes_kind_fields" CHECK (
        ("promo_codes"."kind" = 'percent'
          AND "promo_codes"."percent_off" IS NOT NULL
          AND "promo_codes"."percent_off" BETWEEN 1 AND 99
          AND "promo_codes"."amount_off_sgd" IS NULL)
        OR
        ("promo_codes"."kind" = 'amount'
          AND "promo_codes"."amount_off_sgd" IS NOT NULL
          AND "promo_codes"."amount_off_sgd" > 0
          AND "promo_codes"."percent_off" IS NULL)
      ),
	CONSTRAINT "promo_codes_code_format" CHECK ("promo_codes"."code" ~ '^[A-Z0-9-]{3,24}$'),
	CONSTRAINT "promo_codes_max_positive" CHECK ("promo_codes"."max_redemptions" IS NULL OR "promo_codes"."max_redemptions" > 0)
);
--> statement-breakpoint
ALTER TABLE "promo_code_products" ADD CONSTRAINT "promo_code_products_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "promo_code_redemptions_code_client_unique" ON "promo_code_redemptions" USING btree ("promo_code_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_code_unique" ON "promo_codes" USING btree ("code");