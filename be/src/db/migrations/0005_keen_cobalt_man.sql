CREATE TYPE "public"."workshop_instructor_role" AS ENUM('main', 'supporting');--> statement-breakpoint
CREATE TABLE "corporate_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_sgd" numeric(10, 2) NOT NULL,
	"status" "package_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	CONSTRAINT "corporate_packages_price_positive" CHECK ("corporate_packages"."price_sgd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "class_supporting_instructors" (
	"class_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	CONSTRAINT "class_supporting_instructors_class_id_instructor_id_pk" PRIMARY KEY("class_id","instructor_id")
);
--> statement-breakpoint
CREATE TABLE "corporate_session_supporting_instructors" (
	"corporate_session_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	CONSTRAINT "corporate_session_supporting_instructors_corporate_session_id_instructor_id_pk" PRIMARY KEY("corporate_session_id","instructor_id")
);
--> statement-breakpoint
CREATE TABLE "corporate_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporate_package_id" uuid NOT NULL,
	"client_name" text NOT NULL,
	"main_instructor_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"lifecycle" "lifecycle" DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	CONSTRAINT "corporate_sessions_ends_after_starts" CHECK ("corporate_sessions"."ends_at" > "corporate_sessions"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "classes" RENAME COLUMN "instructor_id" TO "main_instructor_id";--> statement-breakpoint
ALTER TABLE "classes" DROP CONSTRAINT "classes_instructor_id_instructors_staff_user_id_fk";
--> statement-breakpoint
DROP INDEX "classes_instructor_starts_idx";--> statement-breakpoint
ALTER TABLE "workshop_instructors" ADD COLUMN "role" "workshop_instructor_role";--> statement-breakpoint
-- Backfill: deterministically choose one 'main' per workshop.
WITH ranked AS (
  SELECT
    workshop_id,
    instructor_id,
    ROW_NUMBER() OVER (
      PARTITION BY workshop_id
      ORDER BY instructor_id::text
    ) AS rn
  FROM workshop_instructors
)
UPDATE workshop_instructors AS wi
SET role = CASE WHEN r.rn = 1 THEN 'main'::workshop_instructor_role
                ELSE 'supporting'::workshop_instructor_role
           END
FROM ranked r
WHERE wi.workshop_id = r.workshop_id
  AND wi.instructor_id = r.instructor_id;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_packages" ADD CONSTRAINT "corporate_packages_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_supporting_instructors" ADD CONSTRAINT "class_supporting_instructors_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_supporting_instructors" ADD CONSTRAINT "class_supporting_instructors_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_session_supporting_instructors" ADD CONSTRAINT "corporate_session_supporting_instructors_corporate_session_id_corporate_sessions_id_fk" FOREIGN KEY ("corporate_session_id") REFERENCES "public"."corporate_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_session_supporting_instructors" ADD CONSTRAINT "corporate_session_supporting_instructors_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_corporate_package_id_corporate_packages_id_fk" FOREIGN KEY ("corporate_package_id") REFERENCES "public"."corporate_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_main_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("main_instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_cancelled_by_staff_id_staff_users_id_fk" FOREIGN KEY ("cancelled_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_sessions" ADD CONSTRAINT "corporate_sessions_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corporate_packages_status_idx" ON "corporate_packages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "class_supporting_instructors_instructor_idx" ON "class_supporting_instructors" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "corporate_session_supporting_instructors_instructor_idx" ON "corporate_session_supporting_instructors" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "corporate_sessions_starts_at_idx" ON "corporate_sessions" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "corporate_sessions_instructor_starts_idx" ON "corporate_sessions" USING btree ("main_instructor_id","starts_at");--> statement-breakpoint
CREATE INDEX "corporate_sessions_location_starts_idx" ON "corporate_sessions" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "corporate_sessions_room_starts_idx" ON "corporate_sessions" USING btree ("room_id","starts_at");--> statement-breakpoint
CREATE INDEX "corporate_sessions_lifecycle_starts_idx" ON "corporate_sessions" USING btree ("lifecycle","starts_at");--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_main_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("main_instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classes_main_instructor_starts_idx" ON "classes" USING btree ("main_instructor_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workshop_instructors_main_unique" ON "workshop_instructors" USING btree ("workshop_id") WHERE role = 'main';--> statement-breakpoint
CREATE INDEX "workshop_instructors_workshop_role_idx" ON "workshop_instructors" USING btree ("workshop_id","role");