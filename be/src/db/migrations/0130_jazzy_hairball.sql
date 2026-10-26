CREATE TABLE "attention_dismissals" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"dismissed_by_staff_id" uuid NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attention_dismissals" ADD CONSTRAINT "attention_dismissals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_dismissals" ADD CONSTRAINT "attention_dismissals_dismissed_by_staff_id_staff_users_id_fk" FOREIGN KEY ("dismissed_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attention_dismissals_dismissed_by_staff_id_fk_idx" ON "attention_dismissals" USING btree ("dismissed_by_staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attention_dismissals_tenant_kind_subject_uq" ON "attention_dismissals" USING btree ("tenant_id","kind","subject_id");