CREATE TABLE "leave_conflicts" (
	"instructor_a_id" uuid NOT NULL,
	"instructor_b_id" uuid NOT NULL,
	CONSTRAINT "leave_conflicts_instructor_a_id_instructor_b_id_pk" PRIMARY KEY("instructor_a_id","instructor_b_id"),
	CONSTRAINT "leave_conflicts_canonical_order" CHECK ("leave_conflicts"."instructor_a_id" < "leave_conflicts"."instructor_b_id")
);
--> statement-breakpoint
ALTER TABLE "leave_conflicts" ADD CONSTRAINT "leave_conflicts_instructor_a_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_a_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_conflicts" ADD CONSTRAINT "leave_conflicts_instructor_b_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_b_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE cascade ON UPDATE no action;