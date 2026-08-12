CREATE TABLE "leave_pools" (
	"instructor_id" uuid NOT NULL,
	"type" "leave_type" NOT NULL,
	"leave_year" integer NOT NULL,
	"days" numeric(4, 1) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_pools_instructor_id_type_leave_year_pk" PRIMARY KEY("instructor_id","type","leave_year")
);
--> statement-breakpoint
ALTER TABLE "leave_pools" ADD CONSTRAINT "leave_pools_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE cascade ON UPDATE no action;