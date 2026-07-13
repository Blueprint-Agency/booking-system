ALTER TABLE "staff_users" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "gender" "client_gender";--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "languages" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- split combined name into first/last (first token → first_name, remainder → last_name)
-- normalize whitespace first (trim + collapse runs) to match splitName() in src/lib/name.ts,
-- so names with leading/trailing/internal extra spaces split correctly.
UPDATE staff_users SET
  first_name = split_part(btrim(regexp_replace(name, '\s+', ' ', 'g')), ' ', 1),
  last_name  = NULLIF(regexp_replace(btrim(regexp_replace(name, '\s+', ' ', 'g')), '^\S+\s*', ''), '');--> statement-breakpoint
-- lift existing instructor bio/phone up to staff_users
UPDATE staff_users s SET
  bio   = COALESCE(s.bio, i.bio),
  phone = COALESCE(s.phone, i.phone)
FROM instructors i
WHERE i.staff_user_id = s.id;--> statement-breakpoint
ALTER TABLE "instructors" DROP COLUMN "bio";--> statement-breakpoint
ALTER TABLE "instructors" DROP COLUMN "phone";