-- The earliest a member may propose a private session, in days after today
-- (Singapore). Replaces the fixed "from tomorrow" rule; every studio starts at 3,
-- or at its maximum where that is sooner: a minimum past the maximum would leave
-- no day to propose (the service refuses to save one, `min_book_in_advance_after_max`).
ALTER TABLE "pt_booking_config" ADD COLUMN "min_book_in_advance_days" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
UPDATE "pt_booking_config" SET "min_book_in_advance_days" = LEAST(3, "book_in_advance_days");