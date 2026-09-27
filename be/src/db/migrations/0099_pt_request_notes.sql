-- What staff tell the member about their PT request: why the session was
-- scheduled at a time the member did not propose, and why staff cancelled it.
-- Both optional and nullable, so an older build and an older archive ignore them.
ALTER TABLE "pt_requests" ADD COLUMN "schedule_note" text;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD COLUMN "cancel_note" text;