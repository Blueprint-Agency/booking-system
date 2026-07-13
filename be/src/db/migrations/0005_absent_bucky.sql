CREATE TABLE "pt_session_supporting_instructors" (
	"pt_session_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"pay_sgd" numeric(10, 2),
	CONSTRAINT "pt_session_supporting_instructors_pt_session_id_instructor_id_pk" PRIMARY KEY("pt_session_id","instructor_id")
);
--> statement-breakpoint
ALTER TABLE "class_supporting_instructors" ADD COLUMN "pay_sgd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "workshop_instructors" ADD COLUMN "pay_sgd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "pt_session_supporting_instructors" ADD CONSTRAINT "pt_session_supporting_instructors_pt_session_id_pt_sessions_id_fk" FOREIGN KEY ("pt_session_id") REFERENCES "public"."pt_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pt_session_supporting_instructors" ADD CONSTRAINT "pt_session_supporting_instructors_instructor_id_instructors_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."instructors"("staff_user_id") ON DELETE restrict ON UPDATE no action;