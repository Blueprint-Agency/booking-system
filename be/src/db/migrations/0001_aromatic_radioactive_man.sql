ALTER TABLE "class_types" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "class_types" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "class_types" ADD CONSTRAINT "class_types_parent_id_class_types_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."class_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_types_parent_idx" ON "class_types" USING btree ("parent_id");