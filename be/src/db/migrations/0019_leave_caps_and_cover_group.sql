ALTER TABLE "global_policy" ADD COLUMN "cover_group_leave_cap" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_policy" ADD COLUMN "study_leave_cap" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "instructors" ADD COLUMN "in_cover_group" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "global_policy" ADD CONSTRAINT "global_policy_leave_caps_min_1" CHECK ("global_policy"."cover_group_leave_cap" >= 1 AND "global_policy"."study_leave_cap" >= 1);
