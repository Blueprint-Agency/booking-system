ALTER TABLE "workshops" DROP CONSTRAINT "workshops_class_type_id_class_types_id_fk";
--> statement-breakpoint
ALTER TABLE "workshops" DROP COLUMN "class_type_id";