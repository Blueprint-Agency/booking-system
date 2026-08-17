ALTER TABLE "global_policy" DROP CONSTRAINT "global_policy_leave_caps_min_1";--> statement-breakpoint
ALTER TABLE "instructors" DROP COLUMN "in_cover_group";--> statement-breakpoint
ALTER TABLE "global_policy" DROP COLUMN "cover_group_leave_cap";--> statement-breakpoint
ALTER TABLE "global_policy" ADD CONSTRAINT "global_policy_leave_caps_min_1" CHECK ("global_policy"."study_leave_cap" >= 1);