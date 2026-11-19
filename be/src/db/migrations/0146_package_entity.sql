ALTER TABLE "class_packages" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "corporate_packages" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "pt_packages" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "class_packages" ADD CONSTRAINT "class_packages_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_packages" ADD CONSTRAINT "corporate_packages_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_packages" ADD CONSTRAINT "pt_packages_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_packages_entity_id_fk_idx" ON "class_packages" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "corporate_packages_entity_id_fk_idx" ON "corporate_packages" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "pt_packages_entity_id_fk_idx" ON "pt_packages" USING btree ("entity_id");