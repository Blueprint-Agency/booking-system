ALTER TABLE "class_series" ADD COLUMN "cancel_window_hours" integer;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "cancel_window_hours" integer;--> statement-breakpoint
ALTER TABLE "class_series" ADD CONSTRAINT "class_series_cancel_window_non_negative" CHECK ("class_series"."cancel_window_hours" >= 0);--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_cancel_window_non_negative" CHECK ("classes"."cancel_window_hours" >= 0);