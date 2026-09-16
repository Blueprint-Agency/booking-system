ALTER TYPE "public"."auth_event_kind" ADD VALUE 'member_deleted';--> statement-breakpoint
ALTER TABLE "merch_orders" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "client_packages" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_code_redemptions" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_payments" ALTER COLUMN "client_id" DROP NOT NULL;