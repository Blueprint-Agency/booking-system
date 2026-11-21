-- The backfill step of retiring kind `trial` (migrations/README.md rule 0;
-- 0150 was the expand). A Credit Bundle trial is a `credit_bundle` with the
-- trial box ticked, and the build this ships with writes it that way. Every
-- row still stored as `trial` is folded across here.
--
-- The enum keeps its `trial` value, and the trigger 0150 made stays: the build
-- this replaces still writes `trial` while the deploy runs, and after a
-- rollback, and the trigger keeps such a row a trial. Both go in a later
-- migration, once that build is neither running nor the rollback image.
UPDATE "class_packages" SET "kind" = 'credit_bundle', "is_trial" = true WHERE "kind" = 'trial';--> statement-breakpoint
UPDATE "client_packages" SET "kind" = 'credit_bundle', "is_trial" = true WHERE "kind" = 'trial';
