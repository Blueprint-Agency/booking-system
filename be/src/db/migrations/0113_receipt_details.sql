ALTER TABLE "tenant_settings" ADD COLUMN "receipt_prefix" text DEFAULT 'R' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "receipt_legal_name" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "receipt_registration_number" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "receipt_address" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "receipt_footer" text;