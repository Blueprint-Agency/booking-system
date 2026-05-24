-- Backfill missing `instructors` profile rows for any staff_users with
-- role='instructor' that don't have one. This heals data created before the
-- inviteAdmin flow began auto-inserting the profile row (see
-- services/auth/invitations.ts), which was causing FK violations on
-- classes.main_instructor_id → instructors.staff_user_id when admins picked
-- such an instructor in the schedule UI.
INSERT INTO "instructors" ("staff_user_id")
SELECT s.id
FROM "staff_users" s
LEFT JOIN "instructors" i ON i.staff_user_id = s.id
WHERE s.role = 'instructor'
  AND s.deleted_at IS NULL
  AND i.staff_user_id IS NULL;
