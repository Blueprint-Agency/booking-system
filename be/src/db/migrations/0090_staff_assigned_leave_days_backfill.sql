-- Assigned Days move from `instructors` to `staff_users` (#315, be/docs/adr/0009).
--
-- 0089 gave every staff row the 14/14/7 defaults; this copies across the
-- figures an admin had actually set on an instructor. The join is on the id,
-- which is the same value on both tables: an instructor's primary key IS its
-- staff user id. Admins had no figures to copy and keep the defaults.
--
-- Data only, no schema: the snapshot beside it is 0089's, unchanged, which is
-- correct for a `--custom` migration that alters nothing Drizzle describes.
-- The old columns are dropped by 0091, after this has run.
UPDATE "staff_users" AS s
SET
  "annual_leave_days" = i."annual_leave_days",
  "medical_leave_days" = i."medical_leave_days",
  "study_leave_days" = i."study_leave_days"
FROM "instructors" AS i
WHERE i."staff_user_id" = s."id"
  AND i."tenant_id" = s."tenant_id";
