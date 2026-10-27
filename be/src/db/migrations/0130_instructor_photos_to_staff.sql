-- A Profile picture is the staff member's own, on `staff_users`, which
-- the migration before this one added. Copy each instructor's photo across.
--
-- `instructors.photo_r2_key` is not dropped here: the build before this one
-- reads it while the deploy migrates, and a rollback runs that build against
-- this schema (README rule 0). It goes in a later migration, shipped in a later
-- deploy. A staff member who already has a picture keeps theirs.
UPDATE "staff_users" AS s
SET "photo_r2_key" = i."photo_r2_key"
FROM "instructors" AS i
WHERE i."staff_user_id" = s."id"
  AND i."tenant_id" = s."tenant_id"
  AND i."photo_r2_key" IS NOT NULL
  AND s."photo_r2_key" IS NULL;
