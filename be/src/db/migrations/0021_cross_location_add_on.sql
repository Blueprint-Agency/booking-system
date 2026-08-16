ALTER TABLE "client_packages" DROP CONSTRAINT "client_packages_kind_fields";--> statement-breakpoint
ALTER TABLE "global_policy" ADD COLUMN "cross_location_rate_sgd" numeric(10, 2) DEFAULT '30.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "cross_location_paid_sgd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "global_policy" ADD CONSTRAINT "global_policy_cross_location_rate_non_negative" CHECK ("global_policy"."cross_location_rate_sgd" >= 0);--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_kind_fields" CHECK (
        ("client_packages"."kind" = 'unlimited'
          AND "client_packages"."location_id" IS NOT NULL
          AND "client_packages"."duration_months" IS NOT NULL)
        OR
        ("client_packages"."kind" <> 'unlimited'
          AND "client_packages"."location_id" IS NULL
          AND "client_packages"."duration_months" IS NULL
          AND "client_packages"."cross_location_paid_sgd" IS NULL
          AND "client_packages"."expires_at" IS NOT NULL)
      );