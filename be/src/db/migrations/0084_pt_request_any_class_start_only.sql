-- A private-session request names a preferred class type or none ("any"), and
-- proposes start times only; the session's length is set when it is scheduled.
-- Both columns only relax, so the build still running during the deploy, which
-- always writes them, keeps working. Existing rows keep their values.
ALTER TABLE "pt_request_slots" DROP CONSTRAINT "pt_request_slots_end_after_start";--> statement-breakpoint
ALTER TABLE "pt_request_slots" ALTER COLUMN "end_time" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_requests" ALTER COLUMN "class_type_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_request_slots" ADD CONSTRAINT "pt_request_slots_end_after_start" CHECK ("pt_request_slots"."end_time" IS NULL OR "pt_request_slots"."end_time" > "pt_request_slots"."start_time");