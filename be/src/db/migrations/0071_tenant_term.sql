ALTER TABLE "tenants" ADD COLUMN "term_start_date" date DEFAULT CURRENT_DATE NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "term_end_date" date;