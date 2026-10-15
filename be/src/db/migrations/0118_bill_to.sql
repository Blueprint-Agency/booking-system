-- Bill to (#401): the member's chosen Billing details, copied onto the Purchase
-- when it opens and from it onto the Receipt when it is issued. Copies, not
-- references, so a later edit or delete of the set changes nothing issued.
-- Nullable: every Purchase and Receipt before this has none, and reads as the
-- member's name and email, as it did.
ALTER TABLE "purchases" ADD COLUMN "bill_to" jsonb;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "bill_to" jsonb;
