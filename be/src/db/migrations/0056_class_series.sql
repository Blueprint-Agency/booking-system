CREATE TABLE "class_series" (
	"tenant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_type_id" uuid NOT NULL,
	"main_instructor_id" uuid NOT NULL,
	"instructor_pay_sgd" numeric(10, 2) NOT NULL,
	"location_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"capacity_online" integer NOT NULL,
	"capacity_waitlist" integer DEFAULT 0 NOT NULL,
	"capacity_buffer" integer DEFAULT 0 NOT NULL,
	"credit_cost" integer NOT NULL,
	"first_date" date NOT NULL,
	"last_date" date NOT NULL,
	"excluded_dates" date[] DEFAULT '{}' NOT NULL,
	"ended_from" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	CONSTRAINT "class_series_weekday_range" CHECK ("class_series"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "class_series_ends_after_starts" CHECK ("class_series"."end_time" > "class_series"."start_time"),
	CONSTRAINT "class_series_last_not_before_first" CHECK ("class_series"."last_date" >= "class_series"."first_date"),
	CONSTRAINT "class_series_capacity_non_negative" CHECK ("class_series"."capacity_online" >= 0 AND "class_series"."capacity_waitlist" >= 0 AND "class_series"."capacity_buffer" >= 0),
	CONSTRAINT "class_series_capacity_sum_positive" CHECK ("class_series"."capacity_online" + "class_series"."capacity_waitlist" + "class_series"."capacity_buffer" > 0),
	CONSTRAINT "class_series_credit_non_negative" CHECK ("class_series"."credit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "class_series_supporting_instructors" (
	"tenant_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"pay_sgd" numeric(10, 2) NOT NULL,
	CONSTRAINT "class_series_supporting_instructors_series_id_instructor_id_pk" PRIMARY KEY("series_id","instructor_id")
);
--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_class_type_id_class_types_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_main_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("main_instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_created_by_staff_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series_supporting_instructors" ADD CONSTRAINT "class_series_supporting_instructors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series_supporting_instructors" ADD CONSTRAINT "class_series_supporting_instructors_series_id_class_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."class_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_series_supporting_instructors" ADD CONSTRAINT "class_series_supporting_instructors_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_series_class_type_idx" ON "class_series" USING btree ("tenant_id","class_type_id");--> statement-breakpoint
CREATE INDEX "class_series_supporting_instructors_instructor_idx" ON "class_series_supporting_instructors" USING btree ("tenant_id","instructor_id");--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_series_id_class_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."class_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classes_series_starts_idx" ON "classes" USING btree ("tenant_id","series_id","starts_at");