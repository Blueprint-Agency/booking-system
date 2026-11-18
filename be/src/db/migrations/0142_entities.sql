CREATE TABLE "entities" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_position_idx" ON "entities" USING btree ("tenant_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_name_live_unique" ON "entities" USING btree ("tenant_id",lower("name")) WHERE "entities"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entities_slug_live_unique" ON "entities" USING btree ("tenant_id",lower("slug")) WHERE "entities"."archived_at" IS NULL;