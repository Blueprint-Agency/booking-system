-- The member's "approved" celebration: a PT or Corporate Request the studio has
-- scheduled, which the member has yet to see. Set by scheduling a member's
-- request, cleared by POST /me/approvals/:kind/:id/seen. Defaults false, so no
-- existing row, and no row from an archive taken before this column, celebrates.
ALTER TABLE "corporate_requests" ADD COLUMN "approval_unseen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pt_requests" ADD COLUMN "approval_unseen" boolean DEFAULT false NOT NULL;
