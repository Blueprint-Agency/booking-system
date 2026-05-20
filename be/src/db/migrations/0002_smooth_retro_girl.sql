CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "rooms_capacity_positive" CHECK ("rooms"."capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "pt_sessions" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "workshop_days" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rooms_location_archived_idx" ON "rooms" USING btree ("location_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_location_name_lower_unique" ON "rooms" USING btree ("location_id",lower("name"));--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_sessions" ADD CONSTRAINT "pt_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_days" ADD CONSTRAINT "workshop_days_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classes_room_starts_idx" ON "classes" USING btree ("room_id","starts_at");--> statement-breakpoint
CREATE INDEX "pt_sessions_room_starts_idx" ON "pt_sessions" USING btree ("room_id","starts_at");--> statement-breakpoint
CREATE INDEX "workshop_days_room_starts_idx" ON "workshop_days" USING btree ("room_id","starts_at");