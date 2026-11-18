ALTER TABLE "class_types" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "class_types" ADD CONSTRAINT "class_types_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_types_entity_id_fk_idx" ON "class_types" USING btree ("entity_id");