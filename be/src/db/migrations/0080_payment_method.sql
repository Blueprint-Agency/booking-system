CREATE TYPE "public"."offline_payment_method" AS ENUM('cash', 'card', 'paynow', 'bank_transfer', 'other');--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "offline_method" "offline_payment_method";--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "offline_method_label" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "source_sale_id" text;--> statement-breakpoint
ALTER TABLE "stripe_payments" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "stripe_payments" ADD COLUMN "card_brand" text;--> statement-breakpoint
ALTER TABLE "stripe_payments" ADD COLUMN "card_last4" text;--> statement-breakpoint
ALTER TABLE "stripe_payments" ADD COLUMN "wallet" text;