ALTER TYPE "public"."email_log_status" ADD VALUE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."email_log_status" ADD VALUE 'bounced';--> statement-breakpoint
ALTER TYPE "public"."email_log_status" ADD VALUE 'complained';--> statement-breakpoint
ALTER TYPE "public"."email_log_status" ADD VALUE 'delivery_delayed';--> statement-breakpoint
ALTER TYPE "public"."email_log_status" ADD VALUE 'suppressed';--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN "outcome_at" timestamp with time zone;