-- Three tables nothing reads or writes are dropped: the admin Inbox (#237) and
-- waivers (#233) are not being built. `inbox_items` takes its enum with it. Their
-- rows are not archived anywhere else; the pre-migrate snapshot every deploy takes
-- (docs/md/deployment.md) is the way back.
DROP TABLE IF EXISTS "waiver" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "waiver_signatures" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "inbox_items" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."inbox_item_type";
--> statement-breakpoint
-- A request names the session it was scheduled as, and now the database holds it
-- to a session that exists. Nothing ever added the foreign key, so a request can
-- already name an id that is no session. Adding the constraint would refuse the
-- whole migration over such a row, so those ids are cleared first: every reader
-- (the member's list, the cancel, the unseen-approval count) already treats a
-- request whose session is not found as one with no session, so clearing the id
-- changes nothing anyone sees. The request keeps its row, its status and its
-- debit. Each cleared id is printed as a NOTICE (request, studio, status, the id
-- it named) so the deploy log keeps what the column no longer does.
DO $$
DECLARE
  "dangling" record;
BEGIN
  FOR "dangling" IN
    SELECT "r"."id", "r"."tenant_id", "r"."status", "r"."scheduled_pt_session_id" AS "gone"
    FROM "pt_requests" AS "r"
    WHERE "r"."scheduled_pt_session_id" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "pt_sessions" AS "s" WHERE "s"."id" = "r"."scheduled_pt_session_id")
    ORDER BY "r"."tenant_id", "r"."id"
  LOOP
    RAISE NOTICE 'pt_requests % (studio %, status %) named pt_session % which does not exist; cleared',
      "dangling"."id", "dangling"."tenant_id", "dangling"."status", "dangling"."gone";
  END LOOP;
END $$;
--> statement-breakpoint
UPDATE "pt_requests" AS "r"
SET "scheduled_pt_session_id" = NULL
WHERE "r"."scheduled_pt_session_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "pt_sessions" AS "s" WHERE "s"."id" = "r"."scheduled_pt_session_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE "conname" = 'pt_requests_scheduled_pt_session_id_pt_sessions_id_fk'
      AND "conrelid" = 'public.pt_requests'::regclass
  ) THEN
    ALTER TABLE "pt_requests" ADD CONSTRAINT "pt_requests_scheduled_pt_session_id_pt_sessions_id_fk" FOREIGN KEY ("scheduled_pt_session_id") REFERENCES "public"."pt_sessions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pt_requests_scheduled_pt_session_id_fk_idx" ON "pt_requests" USING btree ("scheduled_pt_session_id");
