ALTER TYPE "public"."email_log_status" ADD VALUE 'skipped';--> statement-breakpoint
CREATE TABLE "email_switches" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"enabled" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_switches" ADD CONSTRAINT "email_switches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_switches_tenant_slug_unique" ON "email_switches" USING btree ("tenant_id","slug");