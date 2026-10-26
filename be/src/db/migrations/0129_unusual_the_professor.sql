CREATE TYPE "public"."staff_update_kind" AS ENUM('leave_decided');--> statement-breakpoint
CREATE TABLE "staff_updates" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_staff_id" uuid NOT NULL,
	"kind" "staff_update_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"subject_client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "staff_updates" ADD CONSTRAINT "staff_updates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_updates" ADD CONSTRAINT "staff_updates_recipient_staff_id_staff_users_id_fk" FOREIGN KEY ("recipient_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_updates" ADD CONSTRAINT "staff_updates_subject_client_id_clients_id_fk" FOREIGN KEY ("subject_client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_updates_recipient_staff_id_fk_idx" ON "staff_updates" USING btree ("recipient_staff_id");--> statement-breakpoint
CREATE INDEX "staff_updates_subject_client_id_fk_idx" ON "staff_updates" USING btree ("subject_client_id");--> statement-breakpoint
CREATE INDEX "staff_updates_recipient_read_created_idx" ON "staff_updates" USING btree ("tenant_id","recipient_staff_id","read_at","created_at");